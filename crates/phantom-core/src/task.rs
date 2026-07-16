//! Lightweight task representation / lifecycle tracking.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone)]
pub struct Task {
    pub id: u32,
    pub description: String,
    pub status: TaskStatus,
    pub steps: Vec<String>,
}

impl Task {
    pub fn new(id: u32, description: impl Into<String>) -> Self {
        Self {
            id,
            description: description.into(),
            status: TaskStatus::Pending,
            steps: Vec::new(),
        }
    }
}
