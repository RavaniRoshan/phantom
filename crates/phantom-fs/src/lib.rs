//! File-system / CLI backend for Phantom.

pub mod error;
pub mod operations;
pub mod powershell;
pub mod sandbox;

pub use error::{FsError, Result};
pub use sandbox::{FsMode, Sandbox};
