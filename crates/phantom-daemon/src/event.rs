//! Trigger events that drive the daemon, and the neutral task prompt they map to.

use serde::Deserialize;
use std::path::PathBuf;

/// Inbound webhook payload. Matches the Grand Vision schema (Pillar I.1):
///
/// ```json
/// {
///   "event_type": "email_received",
///   "source": "gmail",
///   "priority": "high",
///   "context": "Email from CEO: 'We need the competitor analysis by 5 PM.'",
///   "attachments": []
/// }
/// ```
///
/// Only `event_type` is required; the rest are optional so a minimal trigger
/// (`{"event_type":"tick"}`) is still accepted.
#[derive(Debug, Clone, Deserialize)]
pub struct WebhookPayload {
    pub event_type: String,
    pub source: Option<String>,
    pub priority: Option<String>,
    pub context: Option<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
}

/// A proactive trigger observed by the daemon. Converted into a task prompt by
/// [`PhantomEvent::to_task_prompt`] before it reaches the agent.
#[derive(Debug)]
pub enum PhantomEvent {
    /// Arrived over the local webhook (`POST /event`).
    Webhook(WebhookPayload),
    /// A file appeared in the watched Inbox directory.
    FileDropped(PathBuf),
}

impl PhantomEvent {
    /// Render the event as the natural-language task prompt handed to the agent.
    pub fn to_task_prompt(&self) -> String {
        match self {
            PhantomEvent::Webhook(p) => format!(
                "{event} from {source} (priority {priority}): {context}\nAttachments: {attachments}",
                event = p.event_type,
                source = p.source.as_deref().unwrap_or("unknown"),
                priority = p.priority.as_deref().unwrap_or("normal"),
                context = p.context.as_deref().unwrap_or(""),
                attachments = if p.attachments.is_empty() {
                    "(none)".to_string()
                } else {
                    p.attachments.join(", ")
                },
            ),
            PhantomEvent::FileDropped(path) => {
                format!("Process the newly dropped file: {}", path.display())
            }
        }
    }
}
