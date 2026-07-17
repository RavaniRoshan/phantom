//! V2 invisible-desktop backend.
//!
//! On Windows this launches a hidden Win32 desktop (`CreateDesktopW`), runs a
//! process on it, captures it via `PrintWindow` (BitBlt returns black on hidden
//! desktops), and injects input with `SendInput`/`PostMessage`. On other
//! platforms a stub implementing the same surface is provided so the crate —
//! and the workspace that depends on it — still type-checks.

#[cfg(windows)]
mod desktop;
#[cfg(windows)]
pub use desktop::VirtualDesktop;

#[cfg(windows)]
mod input;

#[cfg(not(windows))]
mod stub;
#[cfg(not(windows))]
pub use stub::VirtualDesktop;
