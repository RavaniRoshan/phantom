//! Safe/Hero path-enforcement policy (cross-platform, fully testable).

use crate::error::{FsError, Result};
use std::path::{Component, Path, PathBuf};

/// Operating mode for the file-system backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsMode {
    /// Reads allowed anywhere; writes restricted to `allowed` folders.
    Safe,
    /// Full access; no prompts or restrictions.
    Hero,
}

/// Enforces that file operations stay within policy.
#[derive(Debug, Clone)]
pub struct Sandbox {
    mode: FsMode,
    allowed: Vec<PathBuf>,
}

impl Sandbox {
    pub fn new(mode: FsMode, allowed: Vec<PathBuf>) -> Self {
        Self { mode, allowed }
    }

    pub fn mode(&self) -> FsMode {
        self.mode
    }

    /// Read operations are allowed everywhere (low risk).
    pub fn check_read(&self, path: &Path) -> Result<()> {
        let _ = path;
        Ok(())
    }

    /// Write/delete operations: always allowed in Hero; in Safe must be inside
    /// an allowed folder.
    pub fn check_write(&self, path: &Path) -> Result<()> {
        if self.mode == FsMode::Hero {
            return Ok(());
        }
        let target = normalize(path);
        for root in &self.allowed {
            if target.starts_with(&normalize(root)) {
                return Ok(());
            }
        }
        Err(FsError::Security(format!(
            "path {} is outside allowed folders (Safe mode)",
            path.display()
        )))
    }
}

/// Lexically normalize `.` and `..` components (component-wise, no FS access).
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> Sandbox {
        Sandbox::new(FsMode::Safe, vec![PathBuf::from("/safe")])
    }

    #[test]
    fn safe_write_inside_allowed_is_ok() {
        assert!(sandbox().check_write(Path::new("/safe/report.md")).is_ok());
    }

    #[test]
    fn safe_write_outside_allowed_is_denied() {
        assert!(sandbox().check_write(Path::new("/windows/system32/x")).is_err());
    }

    #[test]
    fn safe_write_traverses_up_but_blocked() {
        assert!(sandbox().check_write(Path::new("/safe/../etc/passwd")).is_err());
    }

    #[test]
    fn hero_writes_always_allowed() {
        let s = Sandbox::new(FsMode::Hero, vec![PathBuf::from("/safe")]);
        assert!(s.check_write(Path::new("/anywhere/x")).is_ok());
    }

    #[test]
    fn reads_always_allowed() {
        assert!(sandbox().check_read(Path::new("/elsewhere/secret")).is_ok());
    }
}
