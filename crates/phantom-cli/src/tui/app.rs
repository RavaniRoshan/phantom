//! Application state, event loop, and top-level rendering.

use crate::commands::{parse_command, Command};
use crate::tui::views::{
    render_approval, render_chat, render_help, render_settings, status_line, status_style,
};
use crate::tui::widgets::{render_input, summarize_params};
use crate::tui::Term;
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent};
use phantom_core::{
    Agent, AgentEvent, ApprovalDecision, ApprovalQueue, Config, Mode, PendingApproval, PhantomClient,
};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Style};
use ratatui::text::Line;
use ratatui::widgets::Paragraph;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc::{channel, unbounded_channel, UnboundedSender};

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
    /// HITL approval queue (Phase D) — shown automatically when one or more
    /// actions are paused below the confidence gate.
    Approval,
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
    /// W0.14: the client is kept so every submitted task gets a FRESH Agent
    /// (and therefore fresh browser/desktop state) instead of a clone sharing
    /// one backend.
    client: Option<PhantomClient>,
    /// Per-task event multiplexer: every task forwards `(task_id, event)` here,
    /// so no receiver is ever overwritten when a second task is submitted.
    event_tx: UnboundedSender<(u64, AgentEvent)>,
    events: Option<tokio::sync::mpsc::UnboundedReceiver<(u64, AgentEvent)>>,
    /// Visible task list with per-task status.
    tasks: Vec<TaskRow>,
    next_task_id: u64,
    /// Index of the selected field in the editable settings form.
    settings_field: usize,
    /// When `Some`, the user is editing a field; the string is the live buffer.
    settings_edit: Option<String>,
    /// Cursor position within `settings_edit`.
    settings_cursor: usize,
    /// Optional HITL approval queue (Phase D). When `Some`, the app renders
    /// a live approval view and resolves queued actions on keypress.
    approval: Option<ApprovalQueue>,
    /// Index of the selected pending approval (in the queue's order).
    approval_selected: usize,
    /// Fresh snapshot of the queue, refreshed once per frame in the run loop
    /// so the (sync) `draw` can render it without awaiting.
    approval_snapshot: Vec<PendingApproval>,
}

/// One row in the visible task list (W0.14).
#[derive(Debug, Clone)]
struct TaskRow {
    id: u64,
    label: String,
    status: String,
}

/// Internal select! discriminator for keyboard vs. agent events.
enum Input {
    Key(anyhow::Result<Option<KeyEvent>>),
    Agent(Option<(u64, AgentEvent)>),
}

impl App {
    pub fn new(
        config: Config,
        agent: Option<Agent>,
        client: Option<PhantomClient>,
        approval: Option<ApprovalQueue>,
    ) -> Self {
        let provider = config.provider.clone();
        let mode = config.mode;
        let (event_tx, event_rx) = unbounded_channel::<(u64, AgentEvent)>();
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
            client,
            event_tx,
            events: Some(event_rx),
            tasks: Vec::new(),
            next_task_id: 1,
            settings_field: 0,
            settings_edit: None,
            settings_cursor: 0,
            approval,
            approval_selected: 0,
            approval_snapshot: Vec::new(),
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
        // A single, stable multiplexed receiver for the lifetime of the app.
        let mut rx = self
            .events
            .take()
            .expect("event receiver must exist for the app lifetime");
        loop {
            terminal.draw(|f| self.draw(f))?;

            let input = tokio::select! {
                key = poll_key() => Input::Key(key),
                evt = rx.recv() => Input::Agent(evt),
            };

            match input {
                Input::Key(Ok(Some(k))) => self.handle_key(k).await?,
                Input::Key(Ok(None)) => {}
                Input::Key(Err(e)) => return Err(e),
                Input::Agent(Some((id, e))) => self.handle_agent_event(id, e),
                Input::Agent(None) => {}
            }

            // Auto-surface the approval queue when actions are paused below the
            // confidence gate, and return to Chat once it drains.
            self.approval_snapshot = self.pending_approvals().await;
            self.sync_approval_view();

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

        let running = self
            .tasks
            .iter()
            .filter(|t| t.status == "running" || t.status == "planning")
            .count() as u32;
        let status = status_line(self.mode, &self.provider, self.task_count, running);
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
            View::Approval => {
                render_approval(f, chunks[1], &self.approval_snapshot, self.approval_selected);
            }
        }

        render_input(f, chunks[2], &self.input, self.cursor, self.view);
    }

    async fn handle_key(&mut self, key: KeyEvent) -> Result<()> {
        if self.view == View::Settings {
            self.handle_settings_key(key);
            return Ok(());
        }
        if self.view == View::Approval {
            self.handle_approval_key(key).await;
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
            Command::Tasks => {
                if self.tasks.is_empty() {
                    self.push(Msg::System("No tasks yet.".into()));
                } else {
                    let lines: Vec<String> = self
                        .tasks
                        .iter()
                        .map(|t| format!("  #{} [{}] {}", t.id, t.status, t.label))
                        .collect();
                    self.push(Msg::System(format!("Tasks:\n{}", lines.join("\n"))));
                }
            }
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
        let id = self.next_task_id;
        self.next_task_id += 1;
        self.push(Msg::User(format!("[task {id}] {task}")));
        self.tasks.push(TaskRow {
            id,
            label: task.to_string(),
            status: "queued".to_string(),
        });

        let Some(client) = self.client.clone() else {
            self.set_task_status(id, "failed");
            self.push(Msg::Error(
                "LLM service unreachable — start `python -m phantom_llm.server`.".into(),
            ));
            return Ok(());
        };

        // W0.14: a FRESH Agent per task. Cloning one Agent would share its
        // Arc<Mutex<Option<Backend>>> browser/desktop state across tasks, so a
        // later task would drive the same page/desktop invisibly.
        let cfg = self.config.clone();
        let approval = self.approval.clone();
        let mux = self.event_tx.clone();
        let task_owned = task.to_string();
        tokio::spawn(async move {
            let mut agent = Agent::new(cfg, client);
            agent.set_approval_queue(approval);
            let (tx, mut rx) = channel(64);
            let run = tokio::spawn(async move { agent.run(&task_owned, tx).await });

            // Forward every event, tagged with its task id, to the stable UI
            // multiplexer. Two tasks can now report progress simultaneously.
            while let Some(ev) = rx.recv().await {
                if mux.send((id, ev)).is_err() {
                    break;
                }
            }
            // Surface a typed failure even if no Error event made it through.
            match run.await {
                // On success the agent already emitted Result; don't duplicate.
                Ok(Ok(_)) => {}
                Ok(Err(e)) => {
                    let _ = mux.send((id, AgentEvent::Error(e.to_string())));
                }
                Err(e) => {
                    let _ = mux.send((id, AgentEvent::Error(format!("task panicked: {e}"))));
                }
            }
        });
        self.set_task_status(id, "running");
        Ok(())
    }

    fn set_task_status(&mut self, id: u64, status: &str) {
        if let Some(row) = self.tasks.iter_mut().find(|t| t.id == id) {
            row.status = status.to_string();
        }
    }

    fn handle_agent_event(&mut self, id: u64, e: AgentEvent) {
        let tag = format!("[task {id}] ");
        match e {
            AgentEvent::Plan(steps) => {
                self.set_task_status(id, "planning");
                self.push(Msg::Plan(steps));
            }
            AgentEvent::Action(a) => {
                self.set_task_status(id, "running");
                self.push(Msg::Action(a));
            }
            AgentEvent::Thinking(c) => self.push(Msg::Thinking(format!("{tag}{}", c.text), c.phase)),
            AgentEvent::Result(s) => {
                self.set_task_status(id, "done");
                self.push(Msg::System(format!("✓ {tag}{s}")));
            }
            // Screenshots stream separately (the TUI does not render images);
            // they are surfaced by the headless runtime check instead.
            AgentEvent::Screenshot(_) => {}
            AgentEvent::Error(s) => {
                self.set_task_status(id, "failed");
                self.push(Msg::Error(format!("{tag}{s}")));
            }
        }
    }

    /// Snapshot the pending approvals (id + action) from the shared queue.
    async fn pending_approvals(&self) -> Vec<PendingApproval> {
        match &self.approval {
            Some(q) => q.pending().await,
            None => Vec::new(),
        }
    }

    /// Switch to the Approval view when the queue is non-empty, and back to
    /// Chat once it drains. Reads the per-frame snapshot (set in the run
    /// loop), so it runs synchronously from `draw`'s caller.
    fn sync_approval_view(&mut self) {
        if self.approval.is_none() {
            return;
        }
        let pending = self.approval_snapshot.len();
        // Clamp the selection to the current queue length.
        if pending == 0 {
            self.approval_selected = 0;
            if self.view == View::Approval {
                self.view = View::Chat;
            }
        } else {
            self.approval_selected = self.approval_selected.min(pending - 1);
            if self.view == View::Chat {
                self.view = View::Approval;
            }
        }
    }

    /// Key handling for the Approval Queue view. The agent is *blocked* on the
    /// other side of the queue awaiting our verdict, so every key here resolves
    /// (or batch-resolves) pending requests, which unblocks it.
    async fn handle_approval_key(&mut self, key: KeyEvent) {
        let Some(q) = self.approval.clone() else {
            // No queue: nothing to do (shouldn't happen in this view).
            return;
        };
        let pending = self.pending_approvals().await;
        if pending.is_empty() {
            self.view = View::Chat;
            return;
        }
        let n = pending.len();
        match key.code {
            KeyCode::Up if self.approval_selected > 0 => self.approval_selected -= 1,
            KeyCode::Down if self.approval_selected + 1 < n => self.approval_selected += 1,
            // Approve the selected request.
            KeyCode::Enter => {
                let id = pending[self.approval_selected].id;
                q.resolve(id, ApprovalDecision::Approve).await;
            }
            // Reject the selected request.
            KeyCode::Char('r') => {
                let id = pending[self.approval_selected].id;
                q.resolve(id, ApprovalDecision::Reject).await;
            }
            // Approve every pending request.
            KeyCode::Char('a') => {
                q.resolve_all(ApprovalDecision::Approve).await;
            }
            // Reject every pending request.
            KeyCode::Char('x') => {
                q.resolve_all(ApprovalDecision::Reject).await;
            }
            // Back to the chat transcript (queue stays paused until resolved).
            KeyCode::Esc => self.view = View::Chat,
            _ => {}
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
            2 => self.config.model.clone(),
            3 => self.config.llm_endpoint.clone(),
            // W0.9: the API key lives in Credential Manager, never in config.
            // Seed the edit buffer empty so a fresh value replaces it.
            4 => String::new(),
            5 => self.config.grpc_endpoint.clone(),
            6 => self.config.max_iterations.to_string(),
            7 => self
                .config
                .allowed_folders
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join("; "),
            8 => format!("{:.2}", self.config.confidence_gate),
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
            2 => self.config.model = v,
            3 => self.config.llm_endpoint = v,
            4 => {
                // W0.9: write to the OS credential store, not config.toml.
                match phantom_core::secrets::set_secret(
                    phantom_core::secrets::API_KEY_TARGET,
                    &v,
                ) {
                    Ok(()) => self.push(Msg::System("API key stored in Credential Manager".into())),
                    Err(e) => self.push(Msg::Error(format!("could not store API key: {e}"))),
                }
            }
            5 => self.config.grpc_endpoint = v,
            6 => match v.parse::<u32>() {
                Ok(n) if n > 0 => self.config.max_iterations = n,
                Ok(_) => self.push(Msg::Error("max_iterations must be > 0".into())),
                Err(_) => self.push(Msg::Error("max_iterations must be a number".into())),
            },
            7 => {
                self.config.allowed_folders = v
                    .split([';', ','])
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(PathBuf::from)
                    .collect();
            }
            8 => match v.parse::<f32>() {
                Ok(g) if (0.0..=1.0).contains(&g) => self.config.confidence_gate = g,
                Ok(_) => self.push(Msg::Error(
                    "confidence_gate must be between 0.0 and 1.0".into(),
                )),
                Err(_) => self.push(Msg::Error("confidence_gate must be a number".into())),
            },
            _ => {}
        }
    }

    /// Push live config changes (mode/provider/gate) into the running agent.
    fn apply_settings_to_runtime(&mut self) {
        self.mode = self.config.mode;
        self.provider = self.config.provider.clone();
        if let Some(a) = &mut self.agent {
            a.set_mode(self.config.mode);
            a.set_provider(self.config.provider.clone());
            a.set_confidence_gate(self.config.confidence_gate);
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

// `recv_event` was removed: the app now owns one stable multiplexed receiver,
// so no task can overwrite another's channel (W0.14).
