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

/// A captured image together with its wire MIME and pixel dimensions.
///
/// W0.1 (ADR-001): captures are normalized to PNG at the source, so the MIME
/// travels with the bytes instead of being hard-coded in every LLM provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub width: u32,
    pub height: u32,
}

impl Image {
    pub const PNG_MAGIC: &'static [u8] = b"\x89PNG\r\n\x1a\n";

    /// Assert the magic-byte + MIME contract before an image is sent to a model.
    pub fn is_png(&self) -> bool {
        self.bytes.starts_with(Self::PNG_MAGIC) && self.mime == "image/png"
    }
}

/// Sniff image MIME from magic bytes, defaulting to the normalized PNG format.
pub fn detect_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(Image::PNG_MAGIC) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/png"
    }
}

// The multi-desktop pool (V3 Phase B) is cross-platform: it is built on the
// `VirtualDesktop` surface above (real on Windows, stub elsewhere), so the
// workspace type-checks everywhere. Acquiring a worker only succeeds on Windows.
mod pool;
pub use pool::{recommended_workers, DesktopPool, WorkerLease, DEFAULT_RAM_PER_WORKER};
