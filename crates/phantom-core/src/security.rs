//! Safe/Hero enforcement, layered over `phantom_fs::Sandbox`.

use crate::error::{PhantomError, Result};
use crate::Mode;
use phantom_fs::{FsMode, Sandbox};
use phantom_proto::ActionResponse;
use std::path::{Path, PathBuf};

/// Which actions count as mutating (and therefore restricted in Safe mode).
const WRITE_ACTIONS: &[&str] = &["write_file", "delete_file", "move_file", "copy_file"];

#[derive(Clone)]
pub struct Security {
    sandbox: Sandbox,
}

impl Security {
    pub fn new(mode: Mode, allowed: Vec<PathBuf>) -> Self {
        let fs_mode = if mode == Mode::Safe {
            FsMode::Safe
        } else {
            FsMode::Hero
        };
        Self {
            sandbox: Sandbox::new(fs_mode, allowed),
        }
    }

    pub fn is_safe(&self) -> bool {
        self.sandbox.mode() == FsMode::Safe
    }

    /// Enforce policy for a file action before it is executed. Reads and
    /// Hero-mode writes pass; Safe-mode writes outside `allowed` are denied.
    pub fn check_action(&self, action: &ActionResponse) -> Result<()> {
        if !WRITE_ACTIONS.contains(&action.action.as_str()) {
            return Ok(());
        }
        if let Some(path) = action.params.get("path").or(action.params.get("to")) {
            self.sandbox
                .check_write(Path::new(path))
                .map_err(|e| PhantomError::Security(e.to_string()))?;
        }
        Ok(())
    }
}
