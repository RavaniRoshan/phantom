//! W3 — durable-ish task queue semantics: priority, dedupe, retry, dead-letter.
//!
//! Persistence of queue state is delegated to `RunStore` at the daemon layer;
//! this module owns ordering, dedupe and retry policy so those rules are
//! deterministic and unit-testable.

use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorKind {
    Transient,
    Permanent,
}

/// Classify an error string for retry decisions (W3.6).
pub fn classify_error(err: &str) -> ErrorKind {
    let e = err.to_ascii_lowercase();
    if e.contains("invalid_argument")
        | e.contains("validation")
        | e.contains("policy")
        | e.contains("denied")
        | e.contains("unauthenticated")
        | e.contains("permission")
        | e.contains("permanent")
    {
        ErrorKind::Permanent
    } else {
        ErrorKind::Transient
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedTask {
    pub id: String,
    pub prompt: String,
    pub priority: u8,
    pub dedupe_key: Option<String>,
    pub attempts: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueOutcome {
    Enqueued,
    Duplicate,
}

/// Priority queue with dedupe, retry limits and a dead-letter list.
#[derive(Default)]
pub struct TaskQueue {
    pending: VecDeque<QueuedTask>,
    seen: HashMap<String, String>, // dedupe key -> task id
    dead: Vec<QueuedTask>,
    next_id: u64,
    max_attempts: u8,
}

impl TaskQueue {
    pub fn new(max_attempts: u8) -> Self {
        Self {
            max_attempts: max_attempts.max(1),
            ..Default::default()
        }
    }

    pub fn enqueue(&mut self, prompt: impl Into<String>, priority: u8, dedupe: Option<String>) -> QueueOutcome {
        if let Some(key) = &dedupe {
            if self.seen.contains_key(key) {
                return QueueOutcome::Duplicate;
            }
        }
        self.next_id += 1;
        let task = QueuedTask {
            id: format!("task-{}", self.next_id),
            prompt: prompt.into(),
            priority,
            dedupe_key: dedupe.clone(),
            attempts: 0,
        };
        if let Some(key) = dedupe {
            self.seen.insert(key, task.id.clone());
        }
        // Insert after lower-priority items (higher number = runs first).
        let pos = self
            .pending
            .iter()
            .position(|t| t.priority < task.priority)
            .unwrap_or(self.pending.len());
        self.pending.insert(pos, task);
        QueueOutcome::Enqueued
    }

    pub fn pop(&mut self) -> Option<QueuedTask> {
        self.pending.pop_front()
    }

    pub fn len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// Requeue a failed task as transient (bounded attempts) or dead-letter it.
    pub fn fail(&mut self, mut task: QueuedTask, err: &str) -> bool {
        task.attempts += 1;
        if classify_error(err) == ErrorKind::Permanent || task.attempts >= self.max_attempts {
            if let Some(key) = &task.dedupe_key {
                self.seen.remove(key);
            }
            self.dead.push(task);
            return false;
        }
        self.pending.push_front(task);
        true
    }

    pub fn dead_letter(&self) -> &[QueuedTask] {
        &self.dead
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_transient_vs_permanent() {
        assert_eq!(classify_error("rpc failed: 503 unavailable"), ErrorKind::Transient);
        assert_eq!(classify_error("INVALID_ARGUMENT: bad action"), ErrorKind::Permanent);
        assert_eq!(classify_error("policy denial"), ErrorKind::Permanent);
    }

    #[test]
    fn priority_order_and_dedupe() {
        let mut q = TaskQueue::new(3);
        q.enqueue("low", 1, None);
        q.enqueue("high", 9, None);
        assert_eq!(q.pop().unwrap().prompt, "high");
        assert_eq!(q.pop().unwrap().prompt, "low");
        assert_eq!(q.enqueue("x", 1, Some("k".into())), QueueOutcome::Enqueued);
        assert_eq!(q.enqueue("x", 1, Some("k".into())), QueueOutcome::Duplicate);
    }

    #[test]
    fn transient_retries_then_dead_letters() {
        let mut q = TaskQueue::new(2);
        q.enqueue("task", 1, Some("k".into()));
        let t = q.pop().unwrap();
        assert!(q.fail(t.clone(), "429 rate limit"), "first failure retries");
        let t = q.pop().unwrap();
        assert!(!q.fail(t, "500 internal"), "second failure dead-letters");
        assert_eq!(q.dead_letter().len(), 1);
        assert!(q.is_empty());
    }

    #[test]
    fn permanent_error_dead_letters_immediately() {
        let mut q = TaskQueue::new(5);
        q.enqueue("task", 1, None);
        let t = q.pop().unwrap();
        assert!(!q.fail(t, "INVALID_ARGUMENT"));
        assert_eq!(q.dead_letter().len(), 1);
    }
}
