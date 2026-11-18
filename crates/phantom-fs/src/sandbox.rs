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
            if target.starts_with(normalize(root)) {
                return Ok(());
            }
        }
        Err(FsError::Security(format!(
            "path {} is outside allowed folders (Safe mode)",
            path.display()
        )))
    }
}

/// W4.4: resolve symlinks / canonical paths and ensure the result stays within
/// `root`. Call before any mutating file operation in Safe mode.
pub fn canonicalize_within(root: &Path, path: &Path) -> Result<PathBuf> {
    let root_norm = normalize(root);
    let candidate = if path.exists() {
        strip_verbatim(std::fs::canonicalize(path).map_err(|e| {
            FsError::Security(format!("cannot resolve {}: {e}", path.display()))
        })?)
    } else {
        normalize(path)
    };
    let root_real = if root.exists() {
        strip_verbatim(
            std::fs::canonicalize(root)
                .map_err(|e| FsError::Security(format!("cannot resolve root: {e}")))?,
        )
    } else {
        root_norm
    };
    if candidate.starts_with(&root_real) {
        Ok(candidate)
    } else {
        Err(FsError::Security(format!(
            "path {} escapes {} after canonicalization",
            path.display(),
            root.display()
        )))
    }
}

/// Windows canonicalize() returns a `\\?\` verbatim path; normalize() does not.
/// Strip that prefix so containment comparisons use the same form.
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix("\\\\?\\") {
        PathBuf::from(rest)
    } else {
        p
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
    fn canonicalize_rejects_escape_after_normalization() {
        use super::*;
        let root = std::env::temp_dir().join(format!("phantom-canon-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&root);
        assert!(canonicalize_within(&root, &root.join("ok.txt")).is_ok());
        assert!(canonicalize_within(&root, &root.join("..").join("escape.txt")).is_err());
        let _ = std::fs::remove_dir_all(&root);
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
