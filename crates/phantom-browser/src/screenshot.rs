//! Screenshot persistence helpers.

use anyhow::Result;
use std::path::Path;

/// Write raw PNG bytes to `path`.
pub fn save_png(bytes: &[u8], path: &Path) -> Result<()> {
    std::fs::write(path, bytes)?;
    Ok(())
}
