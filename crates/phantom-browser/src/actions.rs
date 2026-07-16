//! Result of executing one browser action: a fresh screenshot + text context.

/// Output of a single executed browser action, fed back into the agent loop
/// so the LLM can observe the new state on the next `DecideAction`.
#[derive(Debug, Clone, Default)]
pub struct ActionResult {
    /// PNG screenshot of the page after the action.
    pub screenshot: Vec<u8>,
    /// Text/HTML snapshot of the page (used as `current_context`).
    pub context: String,
}
