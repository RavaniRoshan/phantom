//! The OmniAgent brain: plans a task, then runs the observe→decide→execute loop.

use crate::client::PhantomClient;
use crate::config::{Config, Mode};
use crate::security::Security;
use crate::stream::AgentEvent;
use phantom_browser::BrowserBackend;
use phantom_fs;
use phantom_proto::{ActionHistory, ActionRequest, ActionResponse};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;
use tokio_stream::StreamExt;

/// Outcome of executing one action against a backend.
struct StepOutcome {
    screenshot: Option<Vec<u8>>,
    context: String,
    success: bool,
    result: String,
}

/// The orchestrator. Owns the LLM client, the security policy, and lazily
/// launched backends (headless browser, and on Windows a hidden desktop).
#[derive(Clone)]
pub struct Agent {
    config: Config,
    client: PhantomClient,
    security: Security,
    browser: Arc<Mutex<Option<BrowserBackend>>>,
    #[cfg(windows)]
    desktop: Arc<Mutex<Option<phantom_desktop::VirtualDesktop>>>,
    /// Name of the hidden desktop this agent drives. Workers spawned by the
    /// Master Planner set a unique name (`PhantomWorker_N`) so their desktops
    /// don't collide; the default single-agent path uses `PhantomDesktop`.
    desktop_name: String,
}

impl Agent {
    pub fn new(config: Config, client: PhantomClient) -> Self {
        let security = Security::new(config.mode, config.allowed_folders.clone());
        Self {
            config,
            client,
            security,
            browser: Arc::new(Mutex::new(None)),
            #[cfg(windows)]
            desktop: Arc::new(Mutex::new(None)),
            desktop_name: "PhantomDesktop".to_string(),
        }
    }

    /// Set the hidden-desktop name this agent will create/drive. Used by the
    /// Master Planner to isolate each worker on its own `PhantomWorker_N`.
    pub fn set_desktop_name(&mut self, name: impl Into<String>) {
        self.desktop_name = name.into();
    }

    /// Update the active mode (Safe/Hero) at runtime.
    pub fn set_mode(&mut self, mode: Mode) {
        self.config.mode = mode;
        self.security = Security::new(mode, self.config.allowed_folders.clone());
    }

    pub fn set_provider(&mut self, provider: String) {
        self.config.provider = provider;
    }

    /// Run a task to completion, streaming [`AgentEvent`]s to `tx`.
    pub async fn run(&self, task: &str, tx: Sender<AgentEvent>) -> anyhow::Result<()> {
        // 1. Plan.
        let plan = self
            .client
            .plan_task(task, &self.config.mode.to_string())
            .await?;
        tx.send(AgentEvent::Plan(plan.steps.clone())).await.ok();

        // 2. Observe → decide → execute loop.
        self.execute_loop(task, tx).await
    }

    /// Run the observe→decide→execute loop for a single (sub)task WITHOUT
    /// planning or emitting a Plan event. Used by the Master Planner to run one
    /// sub-task per worker — planning happens once, up front, in the planner.
    pub async fn run_subtask(&self, task: &str, tx: Sender<AgentEvent>) -> anyhow::Result<()> {
        self.execute_loop(task, tx).await
    }

    /// The core observe→decide→execute loop shared by [`Agent::run`] and
    /// [`Agent::run_subtask`].
    async fn execute_loop(&self, task: &str, tx: Sender<AgentEvent>) -> anyhow::Result<()> {
        let mut history: Vec<(String, String, bool)> = Vec::new();
        let mut backend = String::new();
        let mut last_screenshot: Option<Vec<u8>> = None;
        let mut last_context = String::new();
        let mut iterations = 0u32;

        loop {
            if iterations >= self.config.max_iterations {
                tx.send(AgentEvent::Error(format!(
                    "reached max iterations ({})",
                    self.config.max_iterations
                )))
                .await
                .ok();
                break;
            }
            iterations += 1;

            let req = ActionRequest {
                screenshot: last_screenshot.clone().unwrap_or_default(),
                task_description: task.to_string(),
                current_context: last_context.clone(),
                history: history
                    .iter()
                    .map(|(a, r, s)| ActionHistory {
                        action: a.clone(),
                        result: r.clone(),
                        success: *s,
                    })
                    .collect(),
                mode: self.config.mode.to_string(),
                backend: backend.clone(),
            };

            // Stream thinking chunks while deciding.
            if let Ok(mut stream) = self.client.stream_thinking(req.clone()).await {
                while let Some(chunk) = stream.next().await {
                    if let Ok(c) = chunk {
                        tx.send(AgentEvent::Thinking(c)).await.ok();
                    }
                }
            }

            // Decide the next action.
            let action: ActionResponse = match self.client.decide_action(req).await {
                Ok(a) => a,
                Err(e) => {
                    tx.send(AgentEvent::Error(format!("decide failed: {e}"))).await.ok();
                    break;
                }
            };
            tx.send(AgentEvent::Action(action.clone())).await.ok();

            if action.action_type == "done" {
                tx.send(AgentEvent::Result(action.reasoning.clone())).await.ok();
                break;
            }

            // Execute against the appropriate backend.
            let outcome = self.execute(&action).await;
            tx.send(AgentEvent::Action(label_action(&action, outcome.success)))
                .await
                .ok();
            history.push((
                format!("{}/{}", action.action_type, action.action),
                outcome.result.clone(),
                outcome.success,
            ));
            last_screenshot = outcome.screenshot.clone();
            if let Some(shot) = &outcome.screenshot {
                tx.send(AgentEvent::Screenshot(shot.clone())).await.ok();
            }
            last_context = outcome.context;
            backend = action.action_type.clone();
        }

        Ok(())
    }

    /// Dispatch an action to the correct backend.
    async fn execute(&self, action: &ActionResponse) -> StepOutcome {
        // Enforce Safe/Hero policy up front.
        if let Err(e) = self.security.check_action(action) {
            return StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: e.to_string(),
            };
        }

        match action.action_type.as_str() {
            "browser" => self.execute_browser(action).await,
            "file" => self.execute_file(action).await,
            "cli" => self.execute_cli(action).await,
            "desktop" => {
                #[cfg(windows)]
                {
                    self.execute_desktop(action).await
                }
                #[cfg(not(windows))]
                {
                    StepOutcome {
                        screenshot: None,
                        context: String::new(),
                        success: false,
                        result: "desktop backend requires Windows (cfg windows)".to_string(),
                    }
                }
            }
            other => StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: format!("unknown backend '{other}'"),
            },
        }
    }

    async fn execute_browser(&self, action: &ActionResponse) -> StepOutcome {
        let mut guard = self.browser.lock().await;
        if guard.is_none() {
            match BrowserBackend::launch().await {
                Ok(b) => *guard = Some(b),
                Err(e) => {
                    return StepOutcome {
                        screenshot: None,
                        context: String::new(),
                        success: false,
                        result: format!("browser launch failed: {e}"),
                    }
                }
            }
        }
        match guard.as_ref().unwrap().execute(action).await {
            Ok(r) => StepOutcome {
                screenshot: Some(r.screenshot),
                context: r.context,
                success: true,
                result: "ok".to_string(),
            },
            Err(e) => StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: e.to_string(),
            },
        }
    }

    /// Dispatch an action to the hidden Windows desktop (V2). The desktop is
    /// launched lazily and reused across actions, just like the browser.
    #[cfg(windows)]
    async fn execute_desktop(&self, action: &ActionResponse) -> StepOutcome {
        let mut guard = self.desktop.lock().await;
        if guard.is_none() {
            match phantom_desktop::VirtualDesktop::launch_named(&self.desktop_name).await {
                Ok(d) => *guard = Some(d),
                Err(e) => {
                    return StepOutcome {
                        screenshot: None,
                        context: String::new(),
                        success: false,
                        result: format!("desktop launch failed: {e}"),
                    }
                }
            }
        }
        let desktop = guard.as_ref().unwrap();

        let outcome = match action.action.as_str() {
            "open" | "navigate" => {
                let target = action
                    .params
                    .get("target")
                    .or_else(|| action.params.get("url"));
                match target {
                    Some(t) => match desktop.open(t).await {
                        Ok(()) => Ok(()),
                        Err(e) => Err(e.to_string()),
                    },
                    None => Err("desktop 'open' requires 'target' or 'url'".to_string()),
                }
            }
            "click" => {
                let x = action.params.get("x").and_then(|v| v.parse::<i32>().ok());
                let y = action.params.get("y").and_then(|v| v.parse::<i32>().ok());
                match (x, y) {
                    (Some(x), Some(y)) => match desktop.click(x, y).await {
                        Ok(()) => Ok(()),
                        Err(e) => Err(e.to_string()),
                    },
                    _ => Err("desktop 'click' requires numeric 'x' and 'y'".to_string()),
                }
            }
            "type_text" => {
                let text = action.params.get("text").cloned();
                let x = action
                    .params
                    .get("x")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(0);
                let y = action
                    .params
                    .get("y")
                    .and_then(|v| v.parse::<i32>().ok())
                    .unwrap_or(0);
                match text {
                    Some(t) => match desktop.type_text(&t, x, y).await {
                        Ok(()) => Ok(()),
                        Err(e) => Err(e.to_string()),
                    },
                    None => Err("desktop 'type_text' requires 'text'".to_string()),
                }
            }
            "screenshot" => match desktop.screenshot().await {
                Ok(bytes) => {
                    return StepOutcome {
                        screenshot: Some(bytes),
                        context: String::new(),
                        success: true,
                        result: "ok".to_string(),
                    }
                }
                Err(e) => Err(e.to_string()),
            },
            other => Err(format!("unsupported desktop action '{other}'")),
        };

        match outcome {
            Ok(()) => {
                // Capture so the observe-loop always has fresh visual state,
                // matching the browser backend's per-action screenshot.
                let screenshot = desktop.screenshot().await.ok();
                StepOutcome {
                    screenshot,
                    context: String::new(),
                    success: true,
                    result: "ok".to_string(),
                }
            }
            Err(e) => StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: e,
            },
        }
    }

    async fn execute_file(&self, action: &ActionResponse) -> StepOutcome {
        let p = |k: &str| action.params.get(k).map(String::as_str);
        let res = match action.action.as_str() {
            "read_file" => p("path").map(|path| phantom_fs::operations::read_file(Path::new(path))),
            "write_file" => p("path").and_then(|path| {
                p("content").map(|content| {
                    phantom_fs::operations::write_file(Path::new(path), content)
                        .map(|_| "ok".to_string())
                })
            }),
            "copy_file" => p("from").and_then(|from| {
                p("to").map(|to| {
                    phantom_fs::operations::copy_file(Path::new(from), Path::new(to))
                        .map(|_| "ok".to_string())
                })
            }),
            "move_file" => p("from").and_then(|from| {
                p("to").map(|to| {
                    phantom_fs::operations::move_file(Path::new(from), Path::new(to))
                        .map(|_| "ok".to_string())
                })
            }),
            "delete_file" => p("path").map(|path| {
                phantom_fs::operations::delete_file(Path::new(path))
                    .map(|_| "ok".to_string())
            }),
            "list_dir" => p("path").map(|path| phantom_fs::operations::list_dir(Path::new(path)).map(|v| v.join("\n"))),
            "search" => p("pattern").and_then(|pat| {
                p("root").map(|root| phantom_fs::operations::search_content(pat, Path::new(root)))
            })
            .map(|r| r.map(|v| v.join("\n"))),
            other => {
                return StepOutcome {
                    screenshot: None,
                    context: String::new(),
                    success: false,
                    result: format!("unsupported file action '{other}'"),
                }
            }
        };
        match res {
            Some(Ok(out)) => StepOutcome {
                screenshot: None,
                context: out.clone(),
                success: true,
                result: out,
            },
            Some(Err(e)) => StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: e.to_string(),
            },
            None => StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: format!("action '{}' requires parameters", action.action),
            },
        }
    }

    async fn execute_cli(&self, action: &ActionResponse) -> StepOutcome {
        let cmd = action
            .params
            .get("command")
            .or_else(|| action.params.get("cmd"))
            .map(String::as_str)
            .unwrap_or("");
        match phantom_fs::powershell::run_command(cmd).await {
            Ok(out) => StepOutcome {
                screenshot: None,
                context: out.clone(),
                success: true,
                result: out,
            },
            Err(e) => StepOutcome {
                screenshot: None,
                context: String::new(),
                success: false,
                result: e.to_string(),
            },
        }
    }
}

/// Build an `action_type=action` label carrying the execution result, so the
/// TUI can show success/failure inline.
fn label_action(action: &ActionResponse, success: bool) -> ActionResponse {
    let mut a = action.clone();
    a.reasoning = format!(
        "{} -> {}",
        if success { "ok" } else { "FAILED" },
        a.reasoning
    );
    a
}
