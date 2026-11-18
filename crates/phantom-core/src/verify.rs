//! W7 — acceptance criteria + verifier pass (prevents false success).

use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Criterion {
    FileExists { path: String },
    FileContains { path: String, text: String },
    OutputContains { output: String, text: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CriterionResult {
    pub criterion: Criterion,
    pub passed: bool,
    pub detail: String,
}

/// Verify all criteria. A task is only `done` when every criterion passes.
pub fn verify(criteria: &[Criterion], root: &Path) -> Vec<CriterionResult> {
    criteria
        .iter()
        .map(|c| {
            let (passed, detail) = match c {
                Criterion::FileExists { path } => {
                    let p = Path::new(path);
                    let ok = if p.is_absolute() { p.exists() } else { root.join(p).exists() };
                    (ok, format!("file '{path}' {}", if ok { "exists" } else { "missing" }))
                }
                Criterion::FileContains { path, text } => {
                    let p = if Path::new(path).is_absolute() {
                        Path::new(path).to_path_buf()
                    } else {
                        root.join(path)
                    };
                    match fs::read_to_string(&p) {
                        Ok(s) => {
                            let ok = s.contains(text);
                            (ok, format!("file '{path}' {}", if ok { "contains" } else { "lacks" }))
                        }
                        Err(e) => (false, format!("cannot read '{path}': {e}")),
                    }
                }
                Criterion::OutputContains { output, text } => {
                    let ok = output.contains(text);
                    (ok, format!("output {}", if ok { "contains" } else { "lacks" }))
                }
            };
            CriterionResult {
                criterion: c.clone(),
                passed,
                detail,
            }
        })
        .collect()
}

pub fn all_passed(results: &[CriterionResult]) -> bool {
    !results.is_empty() && results.iter().all(|r| r.passed)
}

/// W7.3: bounded re-planning budget. Returns whether another attempt is allowed.
pub fn can_replan(attempt: u32, max_attempts: u32) -> bool {
    max_attempts > 0 && attempt < max_attempts
}

#[cfg(test)]
mod replan_tests {
    use super::*;

    #[test]
    fn replan_is_bounded() {
        assert!(can_replan(0, 2));
        assert!(can_replan(1, 2));
        assert!(!can_replan(2, 2));
        assert!(!can_replan(0, 0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_rejects_empty_and_partial_criteria() {
        assert!(!all_passed(&[]));
        let root = std::env::temp_dir();
        let r = verify(
            &[
                Criterion::OutputContains { output: "ok".into(), text: "ok".into() },
                Criterion::OutputContains { output: "ok".into(), text: "missing".into() },
            ],
            &root,
        );
        assert!(!all_passed(&r));
    }

    #[test]
    fn verifier_passes_when_all_criteria_hold() {
        let root = std::env::temp_dir().join(format!("phantom-verify-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        fs::write(root.join("report.txt"), "summary: all good").unwrap();
        let r = verify(
            &[
                Criterion::FileExists { path: "report.txt".into() },
                Criterion::FileContains { path: "report.txt".into(), text: "all good".into() },
            ],
            &root,
        );
        assert!(all_passed(&r));
        let _ = fs::remove_dir_all(&root);
    }
}
