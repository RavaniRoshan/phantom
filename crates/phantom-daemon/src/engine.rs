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
use phantom_core::{
    queue::{QueueOutcome, TaskQueue},
    store::{AuditLog, RunRecord, RunStore},
    Agent, AgentEvent, Config, PhantomClient,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Run the engine loop until the bus closes.
pub async fn run(mut rx: EventRx, cfg: Config, dry_run: bool) {
    // One agent, reused across tasks. Sequential consumption means the desktop
    // backend is never shared concurrently (see Phase B for the pool).
    let mut agent: Option<Agent> = None;
    let shot_seq = AtomicU64::new(0);

    // W3: durable run history + append-only audit log + dedupe/retry queue.
    let data_dir = Config::path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    // rusqlite::Connection is Send but not Sync; wrap it so the async engine
    // future remains Send across awaits.
    let store = match RunStore::open(&data_dir.join("runs.sqlite")) {
        Ok(s) => Some(Arc::new(Mutex::new(s))),
        Err(e) => {
            tracing::warn!("run store unavailable: {e}");
            None
        }
    };
    let mut audit = match AuditLog::open(&data_dir.join("audit.jsonl")) {
        Ok(a) => Some(a),
        Err(e) => {
            tracing::warn!("audit log unavailable: {e}");
            None
        }
    };
    let mut queue = TaskQueue::new(3);
    let mut task_seq = 0u64;

    while let Some(ev) = rx.recv().await {
        let prompt = ev.to_task_prompt();
        // Dedupe identical triggers; priority 1, prompt as the dedupe key.
        if queue.enqueue(prompt.clone(), 1, Some(prompt.clone())) == QueueOutcome::Duplicate {
            tracing::info!("duplicate trigger ignored: {prompt}");
            continue;
        }
        let Some(task) = queue.pop() else { continue };
        let task = task.prompt;
        task_seq += 1;
        let task_id = format!("run-{task_seq}");
        tracing::info!("trigger -> task [{task_id}]: {task}");

        if let Some(s) = &store {
            let _ = s.lock().unwrap().insert_task(&RunRecord {
                id: task_id.clone(),
                task: task.clone(),
                status: "running".into(),
                outcome: String::new(),
                created_at: chrono_like_now(),
            });
        }

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
        // Spawn the run so it is polled while we drain events. Awaiting the
        // drain first deadlocked: the run() future was never polled, so no
        // events could ever arrive. W0.13 also requires failures to surface.
        let task_agent = agent.as_ref().unwrap().clone();
        let task_for_run = task.clone();
        let task_handle = tokio::spawn(async move { task_agent.run(&task_for_run, etx).await });
        drain_events(&mut erx, &shot_seq, store.as_ref(), &mut audit, &task_id).await;

        let result = match task_handle.await {
            Ok(Ok(outcome)) => {
                tracing::info!("task outcome: {outcome:?}");
                Ok(format!("{outcome:?}"))
            }
            Ok(Err(e)) => {
                tracing::error!("task failed: {e}");
                // A transient failure is retried by the queue; permanent ones
                // are classified and dead-lettered there.
                let retry = queue.fail(
                    phantom_core::queue::QueuedTask {
                        id: task_id.clone(),
                        prompt: task.clone(),
                        priority: 1,
                        dedupe_key: Some(task.clone()),
                        attempts: 0,
                    },
                    &e.to_string(),
                );
                tracing::info!("task retry scheduled: {retry}");
                agent = None;
                Err(e.to_string())
            }
            Err(e) => {
                tracing::error!("agent task failed to join: {e}");
                agent = None;
                Err(e.to_string())
            }
        };

        if let (Some(s), Ok(outcome)) = (&store, &result) {
            let _ = s.lock().unwrap().insert_task(&RunRecord {
                id: task_id.clone(),
                task: task.clone(),
                status: "done".into(),
                outcome: outcome.clone(),
                created_at: chrono_like_now(),
            });
        } else if let (Some(s), Err(reason)) = (&store, &result) {
            let _ = s.lock().unwrap().insert_task(&RunRecord {
                id: task_id.clone(),
                task: task.clone(),
                status: "failed".into(),
                outcome: reason.clone(),
                created_at: chrono_like_now(),
            });
        }
    }

    tracing::info!("engine bus closed; exiting");
}

/// ISO-8601-ish timestamp without pulling in a date crate.
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix-{secs}")
}

/// Drain the agent's event stream, logging progress and optionally saving
/// screenshots to `PHANTOM_SHOT_DIR` (reusing the runtime-check convention).
async fn drain_events(
    rx: &mut mpsc::Receiver<AgentEvent>,
    shot_seq: &AtomicU64,
    store: Option<&Arc<Mutex<RunStore>>>,
    audit: &mut Option<AuditLog>,
    task_id: &str,
) {
    let shot_dir = std::env::var("PHANTOM_SHOT_DIR").ok().map(PathBuf::from);
    let mut step_idx = 0usize;
    while let Some(ev) = rx.recv().await {
        match ev {
            AgentEvent::Plan(steps) => {
                tracing::info!("plan: {} subtask(s)", steps.len());
            }
            AgentEvent::Action(a) => {
                let name = format!("{}/{}", a.action_type, a.action);
                tracing::info!("action: {name} — {}", a.reasoning);
                // W3: every executed action is recorded and audit-chained.
                if let Some(s) = store {
                    let _ = s.lock().unwrap().record_step(task_id, step_idx, &name, &a.reasoning);
                }
                if let Some(log) = audit.as_mut() {
                    let params_hash = format!("{:?}", a.params);
                    let _ = log.append(task_id, &name, &params_hash, &a.reasoning);
                }
                step_idx += 1;
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
