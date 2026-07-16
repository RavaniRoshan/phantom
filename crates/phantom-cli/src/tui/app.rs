//! Application state, event loop, and top-level rendering.

use crate::commands::{parse_command, Command};
use crate::tui::views::{render_chat, render_help, render_settings, status_line, status_style};
use crate::tui::widgets::{render_input, summarize_params};
use crate::tui::Term;
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent};
use phantom_core::{Agent, AgentEvent, Config, Mode};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Style};
use ratatui::text::Line;
use ratatui::widgets::Paragraph;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc::{channel, Receiver};

/// A single line/block in the chat transcript.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Agent/Action/Thinking are populated by the Phase 5 action loop
pub enum Msg {
    User(String),
    Agent(String),
    Plan(Vec<phantom_proto::SubTask>),
    Action(phantom_proto::ActionResponse),
    Thinking(String, String),
    System(String),
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    Chat,
    Settings,
    Help,
}

/// The interactive application.
pub struct App {
    config: Config,
    agent: Option<Agent>,
    messages: Vec<Msg>,
    input: String,
    cursor: usize,
    mode: Mode,
    provider: String,
    view: View,
    scroll: u16,
    task_count: u32,
    should_quit: bool,
    events: Option<Receiver<AgentEvent>>,
    /// Index of the selected field in the editable settings form.
    settings_field: usize,
    /// When `Some`, the user is editing a field; the string is the live buffer.
    settings_edit: Option<String>,
    /// Cursor position within `settings_edit`.
    settings_cursor: usize,
}

/// Internal select! discriminator for keyboard vs. agent events.
enum Input {
    Key(anyhow::Result<Option<KeyEvent>>),
    Agent(Option<AgentEvent>),
}

impl App {
    pub fn new(config: Config, agent: Option<Agent>) -> Self {
        let provider = config.provider.clone();
        let mode = config.mode;
        let mut app = App {
            config,
            agent,
            messages: Vec::new(),
            input: String::new(),
            cursor: 0,
            mode,
            provider,
            view: View::Chat,
            scroll: 0,
            task_count: 0,
            should_quit: false,
            events: None,
            settings_field: 0,
            settings_edit: None,
            settings_cursor: 0,
        };
        app.push(Msg::System("Welcome to Phantom — the invisible agent.".into()));
        app.push(Msg::System("Type a task, or /help for commands.".into()));
        if app.agent.is_none() {
            app.push(Msg::Error(
                "LLM service unreachable — start `python -m phantom_llm.server`.".into(),
            ));
        }
        app
    }

    /// Run the main event/render loop until quit.
    pub async fn run(&mut self, terminal: &mut Term) -> Result<()> {
        let mut rx = self.events.take();
        loop {
            if rx.is_none() {
                rx = self.events.take();
            }
            terminal.draw(|f| self.draw(f))?;

            let input = tokio::select! {
                key = poll_key() => Input::Key(key),
                evt = recv_event(&mut rx) => Input::Agent(evt),
            };

            match input {
                Input::Key(Ok(Some(k))) => self.handle_key(k).await?,
                Input::Key(Ok(None)) => {}
                Input::Key(Err(e)) => return Err(e),
                Input::Agent(Some(e)) => self.handle_agent_event(e),
                Input::Agent(None) => {}
            }

            if self.should_quit {
                break;
            }
        }
        Ok(())
    }

    fn draw(&mut self, f: &mut ratatui::Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Min(3),
                Constraint::Length(2),
            ])
            .split(f.area());

        let status = status_line(self.mode, &self.provider, self.task_count);
        f.render_widget(
            Paragraph::new(status).style(status_style(self.mode)),
            chunks[0],
        );

        match self.view {
            View::Chat => render_chat(f, chunks[1], &self.messages, self.scroll),
            View::Settings => render_settings(
                f,
                chunks[1],
                &self.config,
                self.settings_field,
                self.settings_edit.as_deref(),
                self.settings_cursor,
            ),
            View::Help => render_help(f, chunks[1]),
        }

        render_input(f, chunks[2], &self.input, self.cursor, self.view);
    }

    async fn handle_key(&mut self, key: KeyEvent) -> Result<()> {
        if self.view == View::Settings {
            self.handle_settings_key(key);
            return Ok(());
        }
        if key.code == KeyCode::Esc && self.view != View::Chat {
            self.view = View::Chat;
            return Ok(());
        }
        match key.code {
            KeyCode::Enter => self.submit().await?,
            KeyCode::Char(c) => {
                self.input.insert(self.cursor, c);
                self.cursor += 1;
            }
            KeyCode::Backspace => {
                if self.cursor > 0 {
                    self.cursor -= 1;
                    self.input.remove(self.cursor);
                }
            }
            KeyCode::Left if self.cursor > 0 => self.cursor -= 1,
            KeyCode::Right if self.cursor < self.input.chars().count() => self.cursor += 1,
            KeyCode::Up if self.scroll > 0 => self.scroll -= 1,
            KeyCode::Down => self.scroll += 1,
            _ => {}
        }
        Ok(())
    }

    /// Key handling for the editable settings form. Two sub-modes: field
    /// navigation (no active edit) and in-field editing (`settings_edit` set).
    fn handle_settings_key(&mut self, key: KeyEvent) {
        use crate::tui::views::SETTINGS_FIELD_COUNT;
        match self.settings_edit.take() {
            // --- Editing a field. ---
            Some(mut buf) => match key.code {
                KeyCode::Esc => { /* cancel: drop buffer */ }
                KeyCode::Enter => {
                    self.commit_settings_field(self.settings_field, &buf);
                    self.apply_settings_to_runtime();
                }
                KeyCode::Backspace => {
                    if self.settings_cursor > 0 {
                        self.settings_cursor -= 1;
                        buf.remove(self.settings_cursor);
                        self.settings_edit = Some(buf);
                    } else {
                        self.settings_edit = Some(buf);
                    }
                }
                KeyCode::Left if self.settings_cursor > 0 => {
                    self.settings_cursor -= 1;
                    self.settings_edit = Some(buf);
                }
                KeyCode::Right if self.settings_cursor < buf.chars().count() => {
                    self.settings_cursor += 1;
                    self.settings_edit = Some(buf);
                }
                KeyCode::Char(c) => {
                    buf.insert(self.settings_cursor, c);
                    self.settings_cursor += 1;
                    self.settings_edit = Some(buf);
                }
                _ => self.settings_edit = Some(buf),
            },
            // --- Navigating fields. ---
            None => match key.code {
                KeyCode::Esc => self.view = View::Chat,
                KeyCode::Up if self.settings_field > 0 => self.settings_field -= 1,
                KeyCode::Down if self.settings_field + 1 < SETTINGS_FIELD_COUNT => {
                    self.settings_field += 1
                }
                KeyCode::Enter | KeyCode::Char('e') => {
                    let val = self.settings_field_value(self.settings_field);
                    self.settings_cursor = val.chars().count();
                    self.settings_edit = Some(val);
                }
                KeyCode::Char('s') => self.save_settings(),
                _ => {}
            },
        }
    }

    async fn submit(&mut self) -> Result<()> {
        let line = std::mem::take(&mut self.input);
        self.cursor = 0;
        if line.trim().is_empty() {
            return Ok(());
        }
        if line.starts_with('/') {
            self.handle_command(&line[1..]).await?;
        } else {
            self.submit_task(&line).await?;
        }
        Ok(())
    }

    async fn handle_command(&mut self, raw: &str) -> Result<()> {
        let cmd = parse_command(&format!("/{raw}"));
        match cmd {
            Command::Help => self.view = View::Help,
            Command::Settings => {
                self.view = View::Settings;
                self.settings_field = 0;
                self.settings_edit = None;
                self.settings_cursor = 0;
            }
            Command::Safe => {
                self.mode = Mode::Safe;
                self.config.mode = Mode::Safe;
                if let Some(a) = &mut self.agent {
                    a.set_mode(Mode::Safe);
                }
                self.push(Msg::System("Switched to Safe mode.".into()));
            }
            Command::Hero => {
                self.mode = Mode::Hero;
                self.config.mode = Mode::Hero;
                if let Some(a) = &mut self.agent {
                    a.set_mode(Mode::Hero);
                }
                self.push(Msg::System(
                    "⚠ Entered Hero mode — full system access, no permission prompts.".into(),
                ));
            }
            Command::Clear => self.messages.clear(),
            Command::Quit => self.should_quit = true,
            Command::Provider(p) => {
                self.provider = p.clone();
                self.config.provider = p.clone();
                if let Some(a) = &mut self.agent {
                    a.set_provider(p);
                }
                self.push(Msg::System(format!("Provider set to {}.", self.provider)));
            }
            Command::Mode(m) => match m.parse::<Mode>() {
                Ok(mode) => {
                    self.mode = mode;
                    self.config.mode = mode;
                    if let Some(a) = &mut self.agent {
                        a.set_mode(mode);
                    }
                }
                Err(e) => self.push(Msg::Error(e)),
            },
            Command::Unknown(s) => {
                self.push(Msg::Error(format!("Unknown command: {s} (try /help)")))
            }
        }
        Ok(())
    }

    async fn submit_task(&mut self, task: &str) -> Result<()> {
        self.task_count += 1;
        self.push(Msg::User(task.to_string()));

        let Some(agent) = self.agent.clone() else {
            self.push(Msg::Error(
                "LLM service unreachable — start `python -m phantom_llm.server`.".into(),
            ));
            return Ok(());
        };

        let (tx, rx) = channel(64);
        let task_owned = task.to_string();
        tokio::spawn(async move {
            let _ = agent.run(&task_owned, tx).await;
        });
        self.events = Some(rx);
        Ok(())
    }

    fn handle_agent_event(&mut self, e: AgentEvent) {
        match e {
            AgentEvent::Plan(steps) => self.push(Msg::Plan(steps)),
            AgentEvent::Action(a) => self.push(Msg::Action(a)),
            AgentEvent::Thinking(c) => self.push(Msg::Thinking(c.text, c.phase)),
            AgentEvent::Result(s) => self.push(Msg::System(format!("✓ {s}"))),
            AgentEvent::Error(s) => self.push(Msg::Error(s)),
        }
    }

    fn push(&mut self, m: Msg) {
        self.messages.push(m);
    }

    /// Current string value of a settings field, used to seed the edit buffer.
    fn settings_field_value(&self, idx: usize) -> String {
        match idx {
            0 => self.config.provider.clone(),
            1 => self.config.mode.to_string(),
            2 => self.config.llm_endpoint.clone(),
            3 => self.config.api_key.clone(),
            4 => self.config.grpc_endpoint.clone(),
            5 => self.config.max_iterations.to_string(),
            6 => self
                .config
                .allowed_folders
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join("; "),
            _ => String::new(),
        }
    }

    /// Apply an edited buffer back into the config for the given field.
    fn commit_settings_field(&mut self, idx: usize, value: &str) {
        let v = value.trim().to_string();
        match idx {
            0 => self.config.provider = v,
            1 => match v.parse::<Mode>() {
                Ok(m) => self.config.mode = m,
                Err(e) => self.push(Msg::Error(e)),
            },
            2 => self.config.llm_endpoint = v,
            3 => self.config.api_key = v,
            4 => self.config.grpc_endpoint = v,
            5 => match v.parse::<u32>() {
                Ok(n) if n > 0 => self.config.max_iterations = n,
                Ok(_) => self.push(Msg::Error("max_iterations must be > 0".into())),
                Err(_) => self.push(Msg::Error("max_iterations must be a number".into())),
            },
            6 => {
                self.config.allowed_folders = v
                    .split([';', ','])
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(PathBuf::from)
                    .collect();
            }
            _ => {}
        }
    }

    /// Push live config changes (mode/provider) into the running agent.
    fn apply_settings_to_runtime(&mut self) {
        self.mode = self.config.mode;
        self.provider = self.config.provider.clone();
        if let Some(a) = &mut self.agent {
            a.set_mode(self.config.mode);
            a.set_provider(self.config.provider.clone());
        }
    }

    /// Persist the config to disk and report the outcome.
    fn save_settings(&mut self) {
        match self.config.save(&phantom_core::Config::path()) {
            Ok(()) => self.push(Msg::System(format!(
                "✓ Settings saved to {}",
                phantom_core::Config::path().display()
            ))),
            Err(e) => self.push(Msg::Error(format!("save failed: {e}"))),
        }
    }
}

/// Render an `ActionResponse` as a transcript line.
pub(crate) fn action_line(a: &phantom_proto::ActionResponse) -> Line<'static> {
    let summary = summarize_params(&a.params);
    Line::from(format!(
        "  → [{}] {} {}  ({:.0}%)",
        a.action_type,
        a.action,
        summary,
        a.confidence * 100.0
    ))
    .style(Style::default().fg(Color::Blue))
}

async fn poll_key() -> anyhow::Result<Option<KeyEvent>> {
    if event::poll(Duration::from_millis(50))? {
        match event::read()? {
            Event::Key(k) => Ok(Some(k)),
            _ => Ok(None),
        }
    } else {
        Ok(None)
    }
}

async fn recv_event(rx: &mut Option<Receiver<AgentEvent>>) -> Option<AgentEvent> {
    match rx {
        Some(r) => r.recv().await,
        None => std::future::pending().await,
    }
}
