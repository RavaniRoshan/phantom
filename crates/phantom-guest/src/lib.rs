//! B4 — guest agent running inside the VM's interactive session.
//!
//! It captures the real console display, injects input, and exposes a small
//! authenticated HTTP API to the host. Never run as a Session-0 service.

pub mod capture;
pub mod input;
pub mod server;

pub use server::{router, GuestState};
