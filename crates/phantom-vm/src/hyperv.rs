//! B4 — Hyper-V lifecycle commands (PowerShell, checkpoint per task).
//!
//! Command construction is pure and testable; execution only happens when a
//! concrete `HyperVBackend` is used on a Windows Pro/Enterprise host.

use anyhow::{bail, Result};
use crate::{VmBackend, VmConfig};
use async_trait::async_trait;
use phantom_desktop::Image;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HyperVCommands {
    pub vm_name: String,
    pub checkpoint_name: String,
}

impl HyperVCommands {
    pub fn new(vm_name: impl Into<String>, checkpoint_name: impl Into<String>) -> Self {
        Self {
            vm_name: vm_name.into(),
            checkpoint_name: checkpoint_name.into(),
        }
    }

    fn validate(&self) -> Result<()> {
        if self.vm_name.is_empty()
            || self.vm_name.contains([';', '&', '|', '`', '$', '\n', '\r'])
        {
            bail!("invalid VM name");
        }
        if self.checkpoint_name.is_empty()
            || self.checkpoint_name.contains([';', '&', '|', '`', '$', '\n', '\r'])
        {
            bail!("invalid checkpoint name");
        }
        Ok(())
    }

    pub fn start(&self) -> Result<Command> {
        self.validate()?;
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command",
            &format!("Start-VM -Name '{}'", self.vm_name)]);
        Ok(c)
    }

    pub fn stop(&self) -> Result<Command> {
        self.validate()?;
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command",
            &format!("Stop-VM -Name '{}' -Force", self.vm_name)]);
        Ok(c)
    }

    pub fn checkpoint(&self) -> Result<Command> {
        self.validate()?;
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command",
            &format!("Checkpoint-VM -Name '{}' -SnapshotName '{}'",
                self.vm_name, self.checkpoint_name)]);
        Ok(c)
    }

    pub fn restore(&self) -> Result<Command> {
        self.validate()?;
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command",
            &format!("Restore-VMSnapshot -Name '{}' -SnapshotName '{}' -Confirm:$false",
                self.vm_name, self.checkpoint_name)]);
        Ok(c)
    }
}

/// Lifecycle wrapper. Capture/input are delegated to the in-guest agent behind
/// [`VmBackend`], so this backend only owns VM state.
pub struct HyperVBackend {
    cfg: VmConfig,
    commands: HyperVCommands,
}

impl HyperVBackend {
    pub fn new(cfg: VmConfig) -> Self {
        let commands = HyperVCommands::new(cfg.id.clone(), format!("phantom-task-{}", cfg.id));
        Self { cfg, commands }
    }
}

#[async_trait]
impl VmBackend for HyperVBackend {
    async fn open(&self, _target: &str) -> anyhow::Result<()> {
        let status = self.commands.start()?.status()?;
        if !status.success() {
            bail!("Start-VM failed for {}", self.cfg.id);
        }
        self.commands.restore()?.status()?;
        Ok(())
    }
    async fn click(&self, _x: i32, _y: i32) -> anyhow::Result<()> {
        bail!("HyperVBackend delegates input to the guest agent")
    }
    async fn type_text(&self, _text: &str) -> anyhow::Result<()> {
        bail!("HyperVBackend delegates input to the guest agent")
    }
    async fn screenshot(&self) -> anyhow::Result<Image> {
        bail!("HyperVBackend delegates capture to the guest agent")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_built_without_shell_metacharacters() {
        let c = HyperVCommands::new("phantom-qa-win", "task-1");
        assert!(c.start().is_ok());
        assert!(c.stop().is_ok());
        assert!(c.checkpoint().is_ok());
        assert!(c.restore().is_ok());
    }

    #[test]
    fn injection_in_vm_name_is_rejected() {
        assert!(HyperVCommands::new("vm; calc.exe", "snap").start().is_err());
        assert!(HyperVCommands::new("vm", "snap|evil").checkpoint().is_err());
    }
}
