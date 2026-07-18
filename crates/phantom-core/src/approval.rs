//! Human-in-the-loop approval queue (V3 Phase D).
//!
//! The agent's [`phantom_proto::ActionResponse`] carries a `confidence` score.
//! When the agent is less confident than the configured gate (in Safe mode),
//! rather than blindly executing, it *pauses*: it enqueues the action and
//! awaits an [`ApprovalDecision`] from a human operator. A TUI (or any
//! consumer) drains [`ApprovalQueue::pending`], renders the requests, and
//! resolves each with [`ApprovalQueue::resolve`] — which unblocks the agent.
//!
//! Headless callers (daemon, swarm workers) attach no queue; there the gate
//! skips the uncertain action rather than hanging forever.

use phantom_proto::ActionResponse;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};

/// The operator's verdict on a pending action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    /// Execute the action as the model proposed.
    Approve,
    /// Do not execute; record the action as failed/aborted.
    Reject,
}

/// A single pending approval, surfaced to the UI and resolved by the operator.
#[derive(Debug, Clone)]
pub struct PendingApproval {
    pub id: u64,
    pub action: ActionResponse,
}

/// An enqueued request waiting for a human verdict. Internal; the public
/// surface is [`PendingApproval`] snapshots returned by [`ApprovalQueue::pending`].
struct ApprovalRequest {
    id: u64,
    action: ActionResponse,
    respond: oneshot::Sender<ApprovalDecision>,
}

#[derive(Default)]
struct Inner {
    pending: VecDeque<ApprovalRequest>,
    next_id: u64,
}

/// A cheaply-cloneable, shared approval queue. Both the agent (producer) and
/// the TUI (consumer/resolver) hold clones of the same queue.
#[derive(Clone, Default)]
pub struct ApprovalQueue {
    inner: Arc<Mutex<Inner>>,
}

impl ApprovalQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Enqueue `action` for human approval and await the verdict.
    ///
    /// The inner lock is released before awaiting, so the TUI can call
    /// [`ApprovalQueue::resolve`] (which needs the lock) without deadlock.
    /// If the awaiting task is cancelled (e.g. the TUI exits), the oneshot
    /// receiver is dropped and the verdict defaults to
    /// [`ApprovalDecision::Reject`].
    pub async fn enqueue(&self, action: ActionResponse) -> ApprovalDecision {
        let (tx, rx) = oneshot::channel();
        {
            let mut q = self.inner.lock().await;
            let id = q.next_id;
            q.next_id += 1;
            q.pending.push_back(ApprovalRequest {
                id,
                action,
                respond: tx,
            });
        }
        rx.await.unwrap_or(ApprovalDecision::Reject)
    }

    /// Snapshot of currently-pending approvals (id + action), for rendering.
    pub async fn pending(&self) -> Vec<PendingApproval> {
        let q = self.inner.lock().await;
        q.pending
            .iter()
            .map(|r| PendingApproval {
                id: r.id,
                action: r.action.clone(),
            })
            .collect()
    }

    /// Number of pending approvals.
    pub async fn count(&self) -> usize {
        self.inner.lock().await.pending.len()
    }

    /// True when there are no pending approvals.
    pub async fn is_empty(&self) -> bool {
        self.inner.lock().await.pending.is_empty()
    }

    /// Resolve one pending request by `id` with `decision`, unblocking the
    /// agent that enqueued it. No-op if the id is unknown (already resolved).
    pub async fn resolve(&self, id: u64, decision: ApprovalDecision) {
        let mut q = self.inner.lock().await;
        if let Some(pos) = q.pending.iter().position(|r| r.id == id) {
            let req = q.pending.remove(pos).expect("positioned entry exists");
            let _ = req.respond.send(decision);
        }
    }

    /// Resolve every pending request (e.g. "approve all" / "reject all").
    pub async fn resolve_all(&self, decision: ApprovalDecision) {
        let mut q = self.inner.lock().await;
        while let Some(req) = q.pending.pop_front() {
            let _ = req.respond.send(decision);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn action(conf: f32) -> ActionResponse {
        ActionResponse {
            action_type: "cli".into(),
            action: "run_command".into(),
            params: HashMap::new(),
            reasoning: "do a thing".into(),
            confidence: conf,
        }
    }

    #[tokio::test]
    async fn enqueue_awaits_approve_and_unblocks() {
        let q = ApprovalQueue::new();
        let agent_q = q.clone();
        let handle = tokio::spawn(async move { agent_q.enqueue(action(0.3)).await });

        // Let the agent enqueue, then the operator approves.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(q.count().await, 1);
        let pending = q.pending().await;
        assert_eq!(pending.len(), 1);
        q.resolve(pending[0].id, ApprovalDecision::Approve).await;

        let decision = handle.await.unwrap();
        assert_eq!(decision, ApprovalDecision::Approve);
        assert!(q.is_empty().await);
    }

    #[tokio::test]
    async fn enqueue_awaits_reject() {
        let q = ApprovalQueue::new();
        let agent_q = q.clone();
        let handle = tokio::spawn(async move { agent_q.enqueue(action(0.1)).await });

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let pending = q.pending().await;
        q.resolve(pending[0].id, ApprovalDecision::Reject).await;

        assert_eq!(handle.await.unwrap(), ApprovalDecision::Reject);
    }

    #[tokio::test]
    async fn resolve_all_clears_queue_and_unblocks_all() {
        let q = ApprovalQueue::new();
        let a = q.clone();
        let b = q.clone();
        let h1 = tokio::spawn(async move { a.enqueue(action(0.2)).await });
        let h2 = tokio::spawn(async move { b.enqueue(action(0.2)).await });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(q.count().await, 2);
        q.resolve_all(ApprovalDecision::Reject).await;
        assert!(q.is_empty().await);
        assert_eq!(h1.await.unwrap(), ApprovalDecision::Reject);
        assert_eq!(h2.await.unwrap(), ApprovalDecision::Reject);
    }

    #[tokio::test]
    async fn resolve_unknown_id_is_noop() {
        let q = ApprovalQueue::new();
        q.resolve(999, ApprovalDecision::Approve).await;
        assert!(q.is_empty().await);
    }
}
