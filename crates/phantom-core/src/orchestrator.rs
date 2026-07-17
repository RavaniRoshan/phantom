//! The Master Planner swarm (V3 Phase C).
//!
//! Where [`crate::Agent`] runs a single linear observe→decide→execute loop, the
//! [`MasterPlanner`] is a *routing/delegation* node: it decomposes a task into a
//! sub-task graph (one `PlanTask` call), then fans the sub-tasks out across
//! **concurrent workers**, each an independent `Agent` running one sub-task on
//! its own isolated hidden desktop (`PhantomWorker_N`). Results are merged and
//! synthesized into a final summary.
//!
//! Concurrency is bounded two ways: by the configured `max_parallel_workers`
//! and by available system RAM (via `phantom_desktop::recommended_workers`,
//! ~2 GiB/worker), so the swarm never oversubscribes the machine — the same
//! scaling rule the Phase B desktop pool uses.

use crate::config::Config;
use crate::client::PhantomClient;
use crate::stream::AgentEvent;
use crate::Agent;
use phantom_proto::SubTask;
use std::sync::Arc;
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::Semaphore;

/// The outcome of one worker running one sub-task.
#[derive(Debug, Clone)]
pub struct SubtaskResult {
    pub order: i32,
    pub description: String,
    pub backend: String,
    pub success: bool,
    pub summary: String,
}

/// Decomposes a task and runs its sub-tasks concurrently across a worker swarm.
#[derive(Clone)]
pub struct MasterPlanner {
    config: Config,
    client: PhantomClient,
}

impl MasterPlanner {
    pub fn new(config: Config, client: PhantomClient) -> Self {
        Self { config, client }
    }

    /// Effective worker concurrency: the configured cap, further limited by
    /// available RAM. Always at least 1.
    pub fn max_parallel(&self) -> usize {
        let cap = self.config.max_parallel_workers.max(1) as usize;
        phantom_desktop::recommended_workers(phantom_desktop::DEFAULT_RAM_PER_WORKER, cap)
    }

    /// Plan `task`, fan its sub-tasks out across the swarm, and stream progress
    /// to `tx`. Ends by sending a synthesized [`AgentEvent::Result`].
    pub async fn run(&self, task: &str, tx: Sender<AgentEvent>) -> anyhow::Result<()> {
        // 1. Decompose into a sub-task graph.
        let plan = self
            .client
            .plan_task(task, &self.config.mode.to_string())
            .await?;
        tx.send(AgentEvent::Plan(plan.steps.clone())).await.ok();

        // No decomposition -> fall back to a single-agent run (behaves exactly
        // like the classic `Agent::run`, just without re-planning).
        if plan.steps.is_empty() {
            let agent = Agent::new(self.config.clone(), self.client.clone());
            return agent.run_subtask(task, tx).await;
        }

        // 2. Fan out: one worker per sub-task, bounded by `max_parallel()`.
        let limit = self.max_parallel();
        let sem = Arc::new(Semaphore::new(limit));
        tracing::info!(
            "master planner: {} subtask(s), up to {} worker(s) in parallel",
            plan.steps.len(),
            limit
        );

        let mut handles = Vec::with_capacity(plan.steps.len());
        for sub in plan.steps.clone() {
            let sem = sem.clone();
            let cfg = self.config.clone();
            let client = self.client.clone();
            let tx = tx.clone();
            handles.push(tokio::spawn(async move {
                // Acquire a concurrency slot; only `limit` workers run at once.
                let _permit = sem.acquire_owned().await.expect("semaphore open");
                run_worker(cfg, client, sub, tx).await
            }));
        }

        // 3. Collect results (workers already streamed their own events to `tx`).
        let mut results = Vec::with_capacity(handles.len());
        for h in handles {
            match h.await {
                Ok(r) => results.push(r),
                Err(e) => tracing::error!("worker task panicked: {e}"),
            }
        }
        results.sort_by_key(|r| r.order);

        // 4. Synthesize and emit the final summary.
        tx.send(AgentEvent::Result(synthesize(task, &results)))
            .await
            .ok();
        Ok(())
    }
}

/// Run one sub-task on its own worker `Agent` (fresh backends, unique desktop),
/// forwarding its events to `tx` tagged with the worker id, and return the
/// distilled [`SubtaskResult`].
async fn run_worker(
    config: Config,
    client: PhantomClient,
    sub: SubTask,
    tx: Sender<AgentEvent>,
) -> SubtaskResult {
    let mut agent = Agent::new(config, client);
    // Isolate this worker's hidden desktop so parallel Windows workers don't
    // collide on a shared desktop name (reuses Phase B's `launch_named`).
    agent.set_desktop_name(format!("PhantomWorker_{}", sub.order));

    let (wtx, mut wrx) = mpsc::channel::<AgentEvent>(64);
    let desc = sub.description.clone();
    let handle = tokio::spawn(async move { agent.run_subtask(&desc, wtx).await });

    let mut success = true;
    let mut summary = String::new();
    while let Some(ev) = wrx.recv().await {
        match &ev {
            AgentEvent::Result(s) => summary = s.clone(),
            AgentEvent::Error(_) => success = false,
            _ => {}
        }
        tx.send(tag_event(sub.order, ev)).await.ok();
    }

    // Surface a transport/loop error as a failed sub-task.
    if let Ok(Err(e)) = handle.await {
        success = false;
        if summary.is_empty() {
            summary = e.to_string();
        }
    }

    SubtaskResult {
        order: sub.order,
        description: sub.description,
        backend: sub.backend,
        success,
        summary,
    }
}

/// Prefix a worker id onto an event's human-readable text so the UI/logs can
/// attribute streamed events to the right worker. Structural events (`Plan`,
/// `Screenshot`) pass through unchanged.
fn tag_event(order: i32, ev: AgentEvent) -> AgentEvent {
    let tag = format!("[w{order}] ");
    match ev {
        AgentEvent::Action(mut a) => {
            a.reasoning = format!("{tag}{}", a.reasoning);
            AgentEvent::Action(a)
        }
        AgentEvent::Thinking(mut c) => {
            c.text = format!("{tag}{}", c.text);
            AgentEvent::Thinking(c)
        }
        AgentEvent::Result(s) => AgentEvent::Result(format!("{tag}{s}")),
        AgentEvent::Error(s) => AgentEvent::Error(format!("{tag}{s}")),
        other => other,
    }
}

/// Combine per-worker results into a final human-readable summary.
fn synthesize(task: &str, results: &[SubtaskResult]) -> String {
    let ok = results.iter().filter(|r| r.success).count();
    let mut out = format!(
        "Swarm complete: {ok}/{} subtask(s) succeeded for: {task}\n",
        results.len()
    );
    for r in results {
        out.push_str(&format!(
            "  {}. [{}] {} — {}\n",
            r.order,
            r.backend,
            if r.success { "ok" } else { "FAILED" },
            if r.summary.is_empty() { "(no summary)" } else { &r.summary }
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(order: i32, backend: &str, success: bool, summary: &str) -> SubtaskResult {
        SubtaskResult {
            order,
            description: format!("subtask {order}"),
            backend: backend.to_string(),
            success,
            summary: summary.to_string(),
        }
    }

    #[test]
    fn synthesize_counts_successes_and_lists_all() {
        let results = vec![
            r(1, "file", true, "listed dir"),
            r(2, "cli", false, "boom"),
            r(3, "browser", true, "extracted"),
        ];
        let s = synthesize("do things", &results);
        assert!(s.contains("2/3 subtask(s) succeeded"));
        assert!(s.contains("1. [file] ok — listed dir"));
        assert!(s.contains("2. [cli] FAILED — boom"));
        assert!(s.contains("3. [browser] ok — extracted"));
    }

    #[test]
    fn synthesize_handles_empty_summary() {
        let s = synthesize("t", &[r(1, "file", true, "")]);
        assert!(s.contains("1. [file] ok — (no summary)"));
    }

    #[test]
    fn tag_event_prefixes_result_and_error() {
        match tag_event(2, AgentEvent::Result("done".into())) {
            AgentEvent::Result(s) => assert_eq!(s, "[w2] done"),
            _ => panic!("wrong variant"),
        }
        match tag_event(5, AgentEvent::Error("bad".into())) {
            AgentEvent::Error(s) => assert_eq!(s, "[w5] bad"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn tag_event_passes_through_screenshot() {
        matches!(
            tag_event(1, AgentEvent::Screenshot(vec![1, 2, 3])),
            AgentEvent::Screenshot(_)
        );
    }
}
