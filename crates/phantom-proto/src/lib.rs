//! Generated gRPC types for the Phantom agent <-> LLM service contract.
//!
//! Re-exports the `phantom` protobuf package so callers use
//! `phantom_proto::ActionRequest`, `phantom_proto::PhantomLlmClient`, etc.
pub mod phantom {
    tonic::include_proto!("phantom");
}

pub use phantom::*;
