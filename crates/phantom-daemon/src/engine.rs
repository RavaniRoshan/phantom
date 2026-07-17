//! The agent engine (the consumer end of the event bus).
//!
//! Turns each [`PhantomEvent`] into a task prompt and runs it through the
//! existing [`phantom_core::Agent`] observe→decide→execute loop, draining the
//! streamed [`AgentEvent`]s for logging (and optional screenshot capture).
//!
//! Phase A processes events **sequentially** from the single bus receiver, so
//! there is only ever one agent task in flight. This keeps the not-yet-pooled
//! desktop backend safe (it is not shared across concurrent workers) — Phase B
//! introduces a multi-desktop pool and a concurrent Master Planner.

use crate::bus::EventRx;
use phantom_core::{Agent, Config, PhantomClient, AgentEvent};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc;

/// Run the engine loop until the bus closes.
pub async fn run(mut rx: EventRx, cfg: Config, dry_run: bool) {
    // One agent, reused across tasks. Sequential consumption means the desktop
    // backend is never shared concurrently (see Phase B for the pool).
    let mut agent: Option<Agent> = None;
    let shot_seq = AtomicU64::new(0);

    while let Some(ev) = rx.recv().await {
        let task = ev.to_task_prompt();
        tracing::info!("trigger -> task: {task}");

        if dry_run {
            tracing::info!("[dry-run] not invoking the LLM");
            continue;
        }

        // Lazily (re)connect so a Python-service restart recovers at the next event.
        if agent.is_none() {
            match PhantomClient::connect(&cfg.grpc_endpoint).await {
                Ok(client) => agent = Some(Agent::new(cfg.clone(), client)),
                Err(e) => {
                    tracing::error!("LLM service at {} unreachable: {e}", cfg.grpc_endpoint);
                    continue;
                }
            }
        }

        let (etx, mut erx) = mpsc::channel::<AgentEvent>(64);
        let task_handle = agent.as_ref().unwrap().run(&task, etx);
        drain_events(&mut erx, &shot_seq).await;

        if let Err(e) = task_handle.await {
            tracing::error!("task failed: {e}");
            // Drop the agent so the next event reconnects (the failure may have
            // been a transport error from a service restart).
            agent = None;
        }
    }

    tracing::info!("engine bus closed; exiting");
}

/// Drain the agent's event stream, logging progress and optionally saving
/// screenshots to `PHANTOM_SHOT_DIR` (reusing the runtime-check convention).
async fn drain_events(rx: &mut mpsc::Receiver<AgentEvent>, shot_seq: &AtomicU64) {
    let shot_dir = std::env::var("PHANTOM_SHOT_DIR").ok().map(PathBuf::from);
    while let Some(ev) = rx.recv().await {
        match ev {
            AgentEvent::Plan(steps) => {
                tracing::info!("plan: {} subtask(s)", steps.len());
            }
            AgentEvent::Action(a) => {
                tracing::info!("action: {}/{} — {}", a.action_type, a.action, a.reasoning);
            }
            AgentEvent::Thinking(c) => {
                tracing::debug!("thinking[{}]: {}", c.phase, c.text);
            }
            AgentEvent::Result(summary) => {
                tracing::info!("result: {summary}");
            }
            AgentEvent::Error(e) => {
                tracing::error!("agent error: {e}");
            }
            AgentEvent::Screenshot(bytes) => {
                if let Some(dir) = &shot_dir {
                    let n = shot_seq.fetch_add(1, Ordering::Relaxed);
                    let ext = if bytes.starts_with(b"\x89PNG") {
                        "png"
                    } else if bytes.starts_with(b"BM") {
                        "bmp"
                    } else {
                        "bin"
                    };
                    let path = dir.join(format!("daemon-shot-{n}.{ext}"));
                    if let Err(e) = std::fs::write(&path, &bytes) {
                        tracing::warn!("screenshot save failed: {e}");
                    } else {
                        tracing::info!("screenshot saved: {}", path.display());
                    }
                } else {
                    tracing::info!("screenshot captured: {} bytes", bytes.len());
                }
            }
        }
    }
}
