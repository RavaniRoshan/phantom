//! W5.2 — notifications with a testable sink abstraction.

use anyhow::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notification {
    Completed { task_id: String, summary: String },
    Failed { task_id: String, reason: String },
    ApprovalNeeded { task_id: String, action: String },
}

impl Notification {
    pub fn title(&self) -> &'static str {
        match self {
            Notification::Completed { .. } => "Phantom — task complete",
            Notification::Failed { .. } => "Phantom — task failed",
            Notification::ApprovalNeeded { .. } => "Phantom — approval needed",
        }
    }

    pub fn body(&self) -> String {
        match self {
            Notification::Completed { summary, .. } => summary.clone(),
            Notification::Failed { reason, .. } => reason.clone(),
            Notification::ApprovalNeeded { action, .. } => format!("Review: {action}"),
        }
    }
}

pub trait NotificationSink: Send + Sync {
    fn send(&self, n: &Notification) -> Result<()>;
}

/// Sink that records notifications for tests / TUI log.
#[derive(Default)]
pub struct RecordingSink {
    sent: std::sync::Mutex<Vec<Notification>>,
}

impl RecordingSink {
    pub fn drain(&self) -> Vec<Notification> {
        self.sent.lock().unwrap().drain(..).collect()
    }
}

impl NotificationSink for RecordingSink {
    fn send(&self, n: &Notification) -> Result<()> {
        self.sent.lock().unwrap().push(n.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_three_notification_kinds_dispatch() {
        let sink = RecordingSink::default();
        sink.send(&Notification::Completed { task_id: "1".into(), summary: "done".into() }).unwrap();
        sink.send(&Notification::Failed { task_id: "2".into(), reason: "err".into() }).unwrap();
        sink.send(&Notification::ApprovalNeeded { task_id: "3".into(), action: "cli/run".into() }).unwrap();
        let sent = sink.drain();
        assert_eq!(sent.len(), 3);
        assert_eq!(sent[0].title(), "Phantom — task complete");
        assert!(sent[2].body().contains("cli/run"));
    }
}
