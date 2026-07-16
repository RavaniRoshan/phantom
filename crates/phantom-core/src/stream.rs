//! Events emitted by the agent loop, streamed to the TUI in real time.

use phantom_proto::{ActionResponse, SubTask, ThinkingChunk};

/// A single thing that happened during a task, sent to the UI as it occurs.
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// The task was decomposed into subtasks.
    Plan(Vec<SubTask>),
    /// The LLM chose the next action.
    Action(ActionResponse),
    /// A reasoning/thinking chunk (from `StreamThinking`).
    Thinking(ThinkingChunk),
    /// The task finished (carries the final summary).
    Result(String),
    /// Something went wrong.
    Error(String),
}
