//! W4.1 — capability-based policy engine with per-task scopes.
//!
//! Replaces substring denylists with explicit allowlists. A scope is a
//! boundary: anything not granted is denied. Phase 0's `Security` remains as
//! the coarse mode gate; this module is the per-task fine-grained engine.

use crate::error::{PhantomError, Result};
use phantom_proto::ActionResponse;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityScope {
    pub read_paths: Vec<PathBuf>,
    pub write_paths: Vec<PathBuf>,
    pub allowed_apps: Vec<String>,
    pub allowed_domains: Vec<String>,
    /// Shell commands must match one of these executable names exactly.
    pub shell_allowlist: Vec<String>,
    pub network: bool,
}

impl CapabilityScope {
    /// Minimal scope: no filesystem writes, no shell, no network.
    pub fn minimal() -> Self {
        Self {
            read_paths: Vec::new(),
            write_paths: Vec::new(),
            allowed_apps: Vec::new(),
            allowed_domains: Vec::new(),
            shell_allowlist: Vec::new(),
            network: false,
        }
    }

    /// Local file task scope rooted at `root`.
    pub fn for_root(root: &Path) -> Self {
        Self {
            read_paths: vec![root.to_path_buf()],
            write_paths: vec![root.to_path_buf()],
            ..Self::minimal()
        }
    }
}

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    scope: CapabilityScope,
}

impl PolicyEngine {
    pub fn new(scope: CapabilityScope) -> Self {
        Self { scope }
    }

    pub fn scope(&self) -> &CapabilityScope {
        &self.scope
    }

    /// Enforce the scope on an action. Returns a typed denial on any escape.
    pub fn check(&self, action: &ActionResponse) -> Result<()> {
        match action.action_type.as_str() {
            "cli" => self.check_shell(action),
            "file" => self.check_file(action),
            "browser" => self.check_browser(action),
            "desktop" => self.check_desktop(action),
            "done" => Ok(()),
            other => Err(PhantomError::Security(format!(
                "backend '{other}' is not in the capability scope"
            ))),
        }
    }

    fn check_shell(&self, action: &ActionResponse) -> Result<()> {
        let cmd = action
            .params
            .get("command")
            .or_else(|| action.params.get("cmd"))
            .map(String::as_str)
            .unwrap_or("");
        let exe = cmd
            .split_whitespace()
            .next()
            .unwrap_or("")
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if self.scope.shell_allowlist.is_empty() {
            return Err(PhantomError::Security("shell capability not granted".into()));
        }
        if cmd.contains(|c: char| matches!(c, '&' | '|' | ';' | '`' | '\n' | '\r')) {
            return Err(PhantomError::Security("shell command chaining is denied".into()));
        }
        if !self
            .scope
            .shell_allowlist
            .iter()
            .any(|a| a.eq_ignore_ascii_case(&exe))
        {
            return Err(PhantomError::Security(format!(
                "shell executable '{exe}' is not allowlisted"
            )));
        }
        Ok(())
    }

    fn check_file(&self, action: &ActionResponse) -> Result<()> {
        let path = action
            .params
            .get("path")
            .or_else(|| action.params.get("to"))
            .or_else(|| action.params.get("from"));
        let Some(path) = path else {
            return Err(PhantomError::Security("file action has no path".into()));
        };
        let writes = matches!(
            action.action.as_str(),
            "write_file" | "delete_file" | "move_file" | "copy_file"
        );
        let allowed = if writes {
            &self.scope.write_paths
        } else {
            &self.scope.read_paths
        };
        if allowed.is_empty() {
            return Err(PhantomError::Security(
                if writes { "write" } else { "read" }.to_string() + " capability not granted",
            ));
        }
        let p = Path::new(path);
        if !allowed.iter().any(|root| p.starts_with(root)) {
            return Err(PhantomError::Security(format!(
                "path '{path}' escapes the capability scope"
            )));
        }
        Ok(())
    }

    fn check_browser(&self, action: &ActionResponse) -> Result<()> {
        if self.scope.allowed_domains.is_empty() {
            return Err(PhantomError::Security("browser capability not granted".into()));
        }
        if action.action == "navigate" {
            let url = action.params.get("url").map(String::as_str).unwrap_or("");
            let domain = url
                .split("://")
                .nth(1)
                .unwrap_or(url)
                .split('/')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if !self
                .scope
                .allowed_domains
                .iter()
                .any(|d| domain == d.to_ascii_lowercase())
            {
                return Err(PhantomError::Security(format!(
                    "domain '{domain}' is not allowlisted"
                )));
            }
        }
        Ok(())
    }

    fn check_desktop(&self, action: &ActionResponse) -> Result<()> {
        if self.scope.allowed_apps.is_empty() {
            return Err(PhantomError::Security("desktop capability not granted".into()));
        }
        if action.action == "open" {
            let target = action.params.get("target").map(String::as_str).unwrap_or("");
            let app = target
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(target)
                .to_ascii_lowercase();
            if !self
                .scope
                .allowed_apps
                .iter()
                .any(|a| a.eq_ignore_ascii_case(&app))
            {
                return Err(PhantomError::Security(format!(
                    "app '{app}' is not allowlisted"
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn action(kind: &str, name: &str, params: &[(&str, &str)]) -> ActionResponse {
        ActionResponse {
            action_type: kind.into(),
            action: name.into(),
            params: params.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>(),
            reasoning: String::new(),
            confidence: 1.0,
        }
    }

    #[test]
    fn ungranted_capabilities_are_denied_by_default() {
        let engine = PolicyEngine::new(CapabilityScope::minimal());
        assert!(engine.check(&action("cli", "run_command", &[("command", "Get-Date")])).is_err());
        assert!(engine.check(&action("browser", "navigate", &[("url", "https://x.com")])).is_err());
        assert!(engine.check(&action("file", "read_file", &[("path", "x")])).is_err());
        assert!(engine.check(&action("desktop", "open", &[("target", "notepad.exe")])).is_err());
    }

    #[test]
    fn granted_capabilities_allow_in_scope_actions() {
        let mut scope = CapabilityScope::for_root(Path::new("C:/work"));
        scope.shell_allowlist = vec!["Get-Date".into()];
        scope.allowed_domains = vec!["example.com".into()];
        scope.allowed_apps = vec!["notepad.exe".into()];
        let engine = PolicyEngine::new(scope);
        assert!(engine.check(&action("cli", "run_command", &[("command", "Get-Date -Format o")])).is_ok());
        assert!(engine.check(&action("browser", "navigate", &[("url", "https://example.com/a")])).is_ok());
        assert!(engine.check(&action("file", "write_file", &[("path", "C:/work/a.txt")])).is_ok());
        assert!(engine.check(&action("desktop", "open", &[("target", "notepad.exe")])).is_ok());
    }

    #[test]
    fn red_team_50_escape_attempts_all_denied() {
        let engine = PolicyEngine::new(CapabilityScope::for_root(Path::new("C:/work")));
        let mut escapes = Vec::new();
        for i in 0..50 {
            let attempts = [
                action("file", "write_file", &[("path", &format!("C:/Windows/system32/x{i}.dll"))]),
                action("file", "read_file", &[("path", "C:/Windows/win.ini")]),
                action("cli", "run_command", &[("command", "powershell -enc AAA")]),
                action("browser", "navigate", &[("url", "https://evil.example")]),
                action("desktop", "open", &[("target", "cmd.exe /c calc")]),
            ];
            let a = attempts[i % attempts.len()].clone();
            if engine.check(&a).is_ok() {
                escapes.push(a.action.clone());
            }
        }
        assert!(escapes.is_empty(), "capability escapes: {escapes:?}");
    }

    #[test]
    fn shell_chaining_is_denied_even_for_allowlisted_exe() {
        let mut scope = CapabilityScope::for_root(Path::new("C:/work"));
        scope.shell_allowlist = vec!["Get-Date".into()];
        let engine = PolicyEngine::new(scope);
        assert!(engine
            .check(&action("cli", "run_command", &[("command", "Get-Date; calc.exe")]))
            .is_err());
    }
}
