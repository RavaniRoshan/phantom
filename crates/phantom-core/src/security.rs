//! Safe/Hero enforcement, layered over `phantom_fs::Sandbox`.
//!
//! Two classes of action are policed in Safe mode:
//!   1. **File writes** — must stay inside an allowed folder (delegated to
//!      `phantom_fs::Sandbox`).
//!   2. **Shell commands** — the `cli` backend is a large write/destroy hole that
//!      would otherwise bypass the file sandbox entirely, so in Safe mode we
//!      reject commands containing destructive or system-altering verbs. This is
//!      a pragmatic heuristic (we do not parse the shell), documented as such;
//!      Hero mode allows everything.

use crate::error::{PhantomError, Result};
use crate::Mode;
use phantom_fs::{FsMode, Sandbox};
use phantom_proto::ActionResponse;
use std::path::{Path, PathBuf};

/// Which file actions count as mutating (and therefore restricted in Safe mode).
const WRITE_ACTIONS: &[&str] = &["write_file", "delete_file", "move_file", "copy_file"];

/// Substrings that mark a shell command as destructive, irreversible, or a
/// sandbox-bypassing write. Matched case-insensitively against the command
/// padded with spaces. Blocked in Safe mode; allowed in Hero mode.
const DESTRUCTIVE_CLI_PATTERNS: &[&str] = &[
    // File / disk destruction
    "remove-item",
    "remove-itemproperty",
    " rm ",
    "rmdir",
    " del ",
    " erase ",
    "format-volume",
    " format ",
    "clear-disk",
    "clear-content",
    "diskpart",
    "mkfs",
    // Shell-side writes that bypass the file sandbox
    "out-file",
    "set-content",
    "add-content",
    "new-item",
    ">",
    // System / power / policy state changes
    "shutdown",
    "stop-computer",
    "restart-computer",
    "stop-service",
    "set-executionpolicy",
    "reg delete",
    "reg add",
    "bcdedit",
    // Arbitrary code fetch-and-execute
    "invoke-expression",
    " iex ",
    "invoke-webrequest",
    "start-process",
];

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

    /// Enforce policy for an action before it is executed. File writes outside
    /// `allowed` and destructive shell commands are denied in Safe mode; reads,
    /// benign commands, and everything in Hero mode pass.
    pub fn check_action(&self, action: &ActionResponse) -> Result<()> {
        match action.action_type.as_str() {
            "cli" => self.check_cli_action(action),
            // Treat anything else that names a write file-op as a file write,
            // regardless of the declared action_type, so a mislabeled action
            // cannot dodge the sandbox.
            _ => self.check_file_action(action),
        }
    }

    /// File write actions must resolve to a path inside an allowed folder.
    fn check_file_action(&self, action: &ActionResponse) -> Result<()> {
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

    /// Shell commands: in Safe mode reject destructive/system-altering verbs.
    fn check_cli_action(&self, action: &ActionResponse) -> Result<()> {
        if !self.is_safe() {
            return Ok(());
        }
        let cmd = action
            .params
            .get("command")
            .or_else(|| action.params.get("cmd"))
            .map(String::as_str)
            .unwrap_or("");
        if let Some(pattern) = destructive_cli_match(cmd) {
            return Err(PhantomError::Security(format!(
                "command blocked in Safe mode (matched '{}'): {}",
                pattern.trim(),
                cmd
            )));
        }
        Ok(())
    }
}

/// Return the first destructive pattern found in `cmd`, if any.
fn destructive_cli_match(cmd: &str) -> Option<&'static str> {
    // Pad so leading/trailing space-anchored patterns match at the ends too.
    let hay = format!(" {} ", cmd.to_lowercase());
    DESTRUCTIVE_CLI_PATTERNS
        .iter()
        .copied()
        .find(|pat| hay.contains(pat))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn cli(cmd: &str) -> ActionResponse {
        let mut params = HashMap::new();
        params.insert("command".to_string(), cmd.to_string());
        ActionResponse {
            action_type: "cli".to_string(),
            action: "run_command".to_string(),
            params,
            reasoning: String::new(),
            confidence: 1.0,
        }
    }

    fn file_write(path: &str) -> ActionResponse {
        let mut params = HashMap::new();
        params.insert("path".to_string(), path.to_string());
        params.insert("content".to_string(), "x".to_string());
        ActionResponse {
            action_type: "file".to_string(),
            action: "write_file".to_string(),
            params,
            reasoning: String::new(),
            confidence: 1.0,
        }
    }

    fn safe() -> Security {
        Security::new(Mode::Safe, vec![PathBuf::from("/safe")])
    }

    fn hero() -> Security {
        Security::new(Mode::Hero, vec![])
    }

    #[test]
    fn safe_blocks_destructive_commands() {
        for cmd in [
            "Remove-Item -Recurse -Force C:\\Windows",
            "rm -rf /",
            "del important.txt",
            "shutdown /s /t 0",
            "Stop-Computer",
            "Set-Content out.txt 'x'",
            "echo hi > log.txt",
            "reg delete HKLM\\Software\\X",
            "Invoke-Expression $payload",
            "Format-Volume -DriveLetter D",
        ] {
            assert!(
                safe().check_action(&cli(cmd)).is_err(),
                "expected Safe mode to block: {cmd}"
            );
        }
    }

    #[test]
    fn safe_allows_benign_commands() {
        for cmd in [
            "Get-Process",
            "Get-ChildItem",
            "echo hello",
            "Get-Date",
            "whoami",
            "Get-Content notes.txt",
        ] {
            assert!(
                safe().check_action(&cli(cmd)).is_ok(),
                "expected Safe mode to allow: {cmd}"
            );
        }
    }

    #[test]
    fn hero_allows_destructive_commands() {
        assert!(hero().check_action(&cli("Remove-Item -Recurse C:\\x")).is_ok());
        assert!(hero().check_action(&cli("shutdown /s")).is_ok());
    }

    #[test]
    fn safe_blocks_write_outside_allowed() {
        assert!(safe().check_action(&file_write("/etc/passwd")).is_err());
    }

    #[test]
    fn safe_allows_write_inside_allowed() {
        assert!(safe().check_action(&file_write("/safe/report.md")).is_ok());
    }

    #[test]
    fn word_boundary_avoids_false_positives() {
        // "warm" contains "rm" but must not trip the " rm " pattern.
        assert!(safe().check_action(&cli("Write-Output warm")).is_ok());
        // "format" as a substring of another token still trips " format " only
        // when space-delimited; a bare mention inside a word does not.
        assert!(safe().check_action(&cli("Get-Information")).is_ok());
    }
}
