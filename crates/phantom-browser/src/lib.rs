//! Headless browser backend for Phantom (CDP / chromiumoxide).

pub mod actions;
pub mod cdp;
pub mod extraction;
pub mod grounding;
pub mod profile;
pub mod screenshot;
pub mod waits;

pub use actions::ActionResult;
pub use cdp::BrowserBackend;
pub use extraction::{approx_tokens, html_to_context, DEFAULT_MAX_TOKENS, TRUNCATION_MARKER};
pub use profile::ProfileConfig;
