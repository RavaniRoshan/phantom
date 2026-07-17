//! Non-Windows stub for the invisible-desktop backend.
//!
//! Mirrors the public surface of `desktop::VirtualDesktop` but always errors,
//! since the hidden-desktop machinery is Windows-only (`CreateDesktopW`,
//! `PrintWindow`, `SendInput`). This keeps `phantom-desktop` type-checkable on
//! Linux/WSL so the rest of the workspace can be built and tested here.

use anyhow::Result;

/// Placeholder for the Windows-only hidden desktop.
pub struct VirtualDesktop {
    _private: (),
}

const UNAVAILABLE: &str = "the invisible desktop backend is only available on Windows";

impl VirtualDesktop {
    pub async fn launch() -> Result<Self> {
        anyhow::bail!(UNAVAILABLE)
    }

    pub async fn open(&self, _target: &str) -> Result<()> {
        anyhow::bail!(UNAVAILABLE)
    }

    pub async fn click(&self, _x: i32, _y: i32) -> Result<()> {
        anyhow::bail!(UNAVAILABLE)
    }

    pub async fn type_text(&self, _text: &str, _x: i32, _y: i32) -> Result<()> {
        anyhow::bail!(UNAVAILABLE)
    }

    pub async fn screenshot(&self) -> Result<Vec<u8>> {
        anyhow::bail!(UNAVAILABLE)
    }

    pub async fn close(self) -> Result<()> {
        anyhow::bail!(UNAVAILABLE)
    }
}
