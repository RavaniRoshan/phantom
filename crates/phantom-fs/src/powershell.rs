//! CLI execution backend.
//!
//! On Windows this shells out to `powershell.exe`. On non-Windows it is a stub
//! that returns an error, because the agent targets Windows only.
//!
//! W0.10: commands are killed on cancellation/timeout (no orphan processes)
//! and their output is capped so a runaway command cannot flood model context.

use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Maximum stdout/stderr bytes returned to the agent (64 KiB).
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024;

/// W4.3: secrets must never be inherited by a model-triggered shell command
/// (the research report showed `Get-ChildItem Env:` could exfiltrate keys).
pub const SENSITIVE_ENV_KEYS: &[&str] = &[
    "PHANTOM_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "NVIDIA_API_KEY",
    "PHANTOM_WEBHOOK_TOKEN",
];

fn cap(bytes: &[u8]) -> String {
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    if bytes.len() > MAX_OUTPUT_BYTES {
        text = text.chars().take(MAX_OUTPUT_BYTES).collect();
        text.push_str("\n[output truncated]");
    }
    text
}

#[cfg(windows)]
pub async fn run_command(
    cmd: &str,
    timeout: Duration,
    cancel: CancellationToken,
) -> anyhow::Result<String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", cmd]);
    for key in SENSITIVE_ENV_KEYS {
        command.env_remove(key);
    }
    let child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn powershell.exe: {e}"))?;

    let output = tokio::select! {
        _ = cancel.cancelled() => {
            anyhow::bail!("command cancelled");
        }
        _ = tokio::time::sleep(timeout) => {
            anyhow::bail!("command timed out after {}s", timeout.as_secs());
        }
        res = child.wait_with_output() => {
            res.map_err(|e| anyhow::anyhow!("failed to wait for powershell.exe: {e}"))?
        }
    };

    if !output.status.success() {
        anyhow::bail!(
            "command exited with {}: {}",
            output.status,
            cap(&output.stderr)
        );
    }
    Ok(cap(&output.stdout))
}

#[cfg(not(windows))]
pub async fn run_command(
    _cmd: &str,
    _timeout: Duration,
    _cancel: CancellationToken,
) -> anyhow::Result<String> {
    anyhow::bail!("the PowerShell/CLI backend is only available on Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_env_keys_are_scrubbed_from_commands() {
        // The list is applied with env_remove in run_command; assert coverage
        // of every provider key shape used by the LLM service.
        assert!(SENSITIVE_ENV_KEYS.contains(&"PHANTOM_API_KEY"));
        assert!(SENSITIVE_ENV_KEYS.contains(&"PHANTOM_WEBHOOK_TOKEN"));
        assert!(SENSITIVE_ENV_KEYS.len() >= 6);
    }

    #[test]
    fn output_is_capped() {
        let big = vec![b'x'; MAX_OUTPUT_BYTES + 100];
        let text = cap(&big);
        assert!(text.contains("[output truncated]"));
        assert!(text.len() <= MAX_OUTPUT_BYTES + "[output truncated]".len() + 1);
    }
}
