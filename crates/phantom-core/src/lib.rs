//! Phantom core: configuration, errors, and the gRPC client to the LLM service.
//!
//! Higher-level orchestration (the OmniAgent action loop, routing, security
//! enforcement) lives in sibling modules added in later phases.
pub mod agent;
pub mod approval;
pub mod client;
pub mod config;
pub mod error;
pub mod orchestrator;
pub mod router;
pub mod security;
pub mod stream;
pub mod task;

pub use agent::Agent;
pub use approval::{ApprovalDecision, ApprovalQueue, PendingApproval};
pub use client::PhantomClient;
pub use config::{Config, Mode};
pub use error::{PhantomError, Result};
pub use orchestrator::{MasterPlanner, SubtaskResult};
pub use router::route_for;
pub use security::Security;
pub use stream::AgentEvent;
