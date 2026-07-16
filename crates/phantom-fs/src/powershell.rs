//! CLI execution backend.
//!
//! On Windows this shells out to `powershell.exe`. On non-Windows it is a stub
//! that returns an error, because the agent targets Windows only.

#[cfg(windows)]
pub async fn run_command(cmd: &str) -> anyhow::Result<String> {
    use std::process::Command;

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", cmd])
        .output()
        .map_err(|e| anyhow::anyhow!("failed to spawn powershell.exe: {e}"))?;

    if !output.status.success() {
        anyhow::bail!(
            "command exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(not(windows))]
pub async fn run_command(_cmd: &str) -> anyhow::Result<String> {
    anyhow::bail!("the PowerShell/CLI backend is only available on Windows")
}
