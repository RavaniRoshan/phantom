//! Golden-task harness (W0.11).
//!
//! Task definitions are plain YAML (`bench/tasks/{desktop,browser,files}.yaml`)
//! with a deterministic setup, a prompt, a success check and artifact paths.
//! The headless runner (`examples/bench.rs`) executes the file/CLI tasks
//! locally and reports desktop/browser tasks as `live` (they need a running
//! LLM service + Windows desktop, and are exercised by the Windows CI job).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Desktop,
    Browser,
    Files,
}

impl std::fmt::Display for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Backend::Desktop => write!(f, "desktop"),
            Backend::Browser => write!(f, "browser"),
            Backend::Files => write!(f, "files"),
        }
    }
}

/// A declarative setup/action operation — cross-platform, no shell parsing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BenchOp {
    Mkdir { path: String },
    WriteFile { path: String, content: String },
    RemoveFile { path: String },
    /// Deterministic CLI task: run a command and require exit status 0.
    Run { command: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SuccessCheck {
    FileExists { path: String },
    FileContains { path: String, text: String },
    FileEquals { path: String, content: String },
    DirExists { path: String },
    FileNotExists { path: String },
    OutputContains { command: String, text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoldenTask {
    pub id: String,
    pub backend: Backend,
    pub prompt: String,
    #[serde(default)]
    pub setup: Vec<BenchOp>,
    /// Deterministic action (file/CLI tasks) — absent for live tasks.
    #[serde(default)]
    pub action: Option<BenchOp>,
    pub check: SuccessCheck,
    #[serde(default)]
    pub artifacts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub id: String,
    pub backend: Backend,
    pub passed: bool,
    /// `pass`, `fail`, `skipped` (live backend not available).
    pub status: String,
    pub reason: String,
}

/// Replace `{workdir}` in a task-defined path/command.
pub fn expand(s: &str, workdir: &Path) -> String {
    s.replace("{workdir}", &workdir.to_string_lossy())
}

/// Load all golden tasks from a directory of YAML files.
pub fn load_tasks(dir: &Path) -> anyhow::Result<Vec<GoldenTask>> {
    let mut all = Vec::new();
    for file in ["desktop.yaml", "browser.yaml", "files.yaml"] {
        let path = dir.join(file);
        if !path.exists() {
            anyhow::bail!("missing golden-task file: {}", path.display());
        }
        let text = fs::read_to_string(&path)?;
        let tasks: Vec<GoldenTask> = serde_yaml::from_str(&text)
            .map_err(|e| anyhow::anyhow!("invalid {}: {e}", path.display()))?;
        all.extend(tasks);
    }
    Ok(all)
}

/// Execute one declarative operation for a deterministic task.
pub fn execute_op(op: &BenchOp, workdir: &Path) -> anyhow::Result<String> {
    match op {
        BenchOp::Mkdir { path } => {
            fs::create_dir_all(expand(path, workdir))?;
            Ok(String::new())
        }
        BenchOp::WriteFile { path, content } => {
            let p = expand(path, workdir);
            if let Some(parent) = Path::new(&p).parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&p, expand(content, workdir))?;
            Ok(String::new())
        }
        BenchOp::RemoveFile { path } => {
            let p = expand(path, workdir);
            if Path::new(&p).exists() {
                fs::remove_file(&p)?;
            }
            Ok(String::new())
        }
        BenchOp::Run { command } => {
            // Deterministic CLI check only. Split on spaces (no shell), so a
            // golden task can never inject shell syntax.
            let parts: Vec<&str> = command.split_whitespace().collect();
            if parts.is_empty() {
                anyhow::bail!("empty command");
            }
            let out = std::process::Command::new(parts[0])
                .args(&parts[1..])
                .output()?;
            if !out.status.success() {
                anyhow::bail!("command failed: {}", String::from_utf8_lossy(&out.stderr));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
    }
}

/// Evaluate a task's success check after setup/action have run.
pub fn evaluate(task: &GoldenTask, workdir: &Path) -> TaskResult {
    let verdict = match &task.check {
        SuccessCheck::FileExists { path } => {
            Path::new(&expand(path, workdir)).exists().then_some(()).ok_or_else(|| "file missing".to_string())
        }
        SuccessCheck::DirExists { path } => Path::new(&expand(path, workdir))
            .is_dir()
            .then_some(())
            .ok_or_else(|| "directory missing".to_string()),
        SuccessCheck::FileNotExists { path } => (!Path::new(&expand(path, workdir)).exists())
            .then_some(())
            .ok_or_else(|| "file unexpectedly exists".to_string()),
        SuccessCheck::FileContains { path, text } => {
            match fs::read_to_string(expand(path, workdir)) {
                Ok(s) => s.contains(text).then_some(()).ok_or_else(|| "text not found".to_string()),
                Err(e) => Err(format!("cannot read file: {e}")),
            }
        }
        SuccessCheck::FileEquals { path, content } => {
            match fs::read_to_string(expand(path, workdir)) {
                Ok(s) => (s == expand(content, workdir))
                    .then_some(())
                    .ok_or_else(|| "content mismatch".to_string()),
                Err(e) => Err(format!("cannot read file: {e}")),
            }
        }
        SuccessCheck::OutputContains { command, text } => {
            match execute_op(&BenchOp::Run { command: command.clone() }, workdir) {
                Ok(out) => out.contains(text).then_some(()).ok_or_else(|| "output missing text".to_string()),
                Err(e) => Err(e.to_string()),
            }
        }
    };
    match verdict {
        Ok(()) => TaskResult {
            id: task.id.clone(),
            backend: task.backend,
            passed: true,
            status: "pass".into(),
            reason: String::new(),
        },
        Err(reason) => TaskResult {
            id: task.id.clone(),
            backend: task.backend,
            passed: false,
            status: "fail".into(),
            reason,
        },
    }
}

/// Run all deterministic setup+action steps for a file/CLI task, then evaluate.
pub fn run_deterministic(task: &GoldenTask, workdir: &Path) -> anyhow::Result<TaskResult> {
    for op in &task.setup {
        execute_op(op, workdir)?;
    }
    if let Some(action) = &task.action {
        execute_op(action, workdir)?;
    }
    Ok(evaluate(task, workdir))
}

/// Default task directory, resolved relative to the workspace root.
pub fn default_task_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../bench/tasks")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_substitutes_workdir() {
        assert_eq!(
            expand("{workdir}/x.txt", Path::new("C:/tmp/bench")),
            "C:/tmp/bench/x.txt"
        );
    }

    #[test]
    fn deterministic_task_passes_and_fails() {
        let dir = std::env::temp_dir().join(format!("phantom-bench-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let task: GoldenTask = serde_yaml::from_str(
            "id: t1\nbackend: files\nprompt: create\nsetup: []\naction:\n  type: write_file\n  path: '{workdir}/a.txt'\n  content: hello\ncheck:\n  type: file_contains\n  path: '{workdir}/a.txt'\n  text: hello\n",
        )
        .unwrap();
        let r = run_deterministic(&task, &dir).unwrap();
        assert!(r.passed, "{}", r.reason);
        let bad: GoldenTask = serde_yaml::from_str(
            "id: t2\nbackend: files\nprompt: x\nsetup: []\ncheck:\n  type: file_exists\n  path: '{workdir}/missing.txt'\n",
        )
        .unwrap();
        assert!(!evaluate(&bad, &dir).passed);
        let _ = fs::remove_dir_all(&dir);
    }
}
