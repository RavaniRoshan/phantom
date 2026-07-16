//! Headless browser backend for Phantom (CDP / chromiumoxide).

pub mod actions;
pub mod cdp;
pub mod screenshot;

pub use actions::ActionResult;
pub use cdp::BrowserBackend;
