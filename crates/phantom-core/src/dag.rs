//! W6.1 — plan DAG with dependency-respecting, bounded-parallel scheduling.

use crate::error::{PhantomError, Result};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanStep {
    pub id: String,
    pub backend: String,
    pub depends_on: Vec<String>,
}

/// Validate the DAG and return execution waves: steps in the same wave can run
/// in parallel; every step runs after all its dependencies.
pub fn schedule_waves(steps: &[PlanStep], max_parallel: usize) -> Result<Vec<Vec<String>>> {
    let max_parallel = max_parallel.max(1);
    let ids: HashSet<&str> = steps.iter().map(|s| s.id.as_str()).collect();
    let mut indegree: HashMap<&str, usize> = HashMap::new();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
    for s in steps {
        for dep in &s.depends_on {
            if !ids.contains(dep.as_str()) {
                return Err(PhantomError::Config(format!(
                    "step '{}' depends on unknown step '{}'",
                    s.id, dep
                )));
            }
            if dep == &s.id {
                return Err(PhantomError::Config(format!(
                    "step '{}' depends on itself",
                    s.id
                )));
            }
            *indegree.entry(s.id.as_str()).or_default() += 1;
            dependents.entry(dep.as_str()).or_default().push(s.id.as_str());
        }
    }

    let mut ready: VecDeque<&str> = steps
        .iter()
        .filter(|s| indegree.get(s.id.as_str()).copied().unwrap_or(0) == 0)
        .map(|s| s.id.as_str())
        .collect();
    let mut waves = Vec::new();
    let mut scheduled = 0usize;
    while !ready.is_empty() {
        let mut wave = Vec::new();
        // Snapshot the current ready set: steps that become ready *while*
        // processing this wave must wait for the next wave (they depend on a
        // step in this wave). Draining first prevents that dependency violation.
        let batch: Vec<&str> = ready.drain(..).collect();
        for id in batch.into_iter().take(max_parallel) {
            wave.push(id.to_string());
            scheduled += 1;
            if let Some(kids) = dependents.get(id) {
                for kid in kids {
                    let n = indegree.get_mut(kid).expect("indegree entry");
                    *n -= 1;
                    if *n == 0 {
                        ready.push_back(kid);
                    }
                }
            }
        }
        if wave.is_empty() {
            break;
        }
        waves.push(wave);
    }
    if scheduled != steps.len() {
        return Err(PhantomError::Config("plan DAG contains a cycle".into()));
    }
    Ok(waves)
}

/// W6.2: a step's backend is a constraint; mismatched execution is an error.
pub fn enforce_backend(step_backend: &str, executed_backend: &str) -> Result<()> {
    if step_backend == executed_backend {
        Ok(())
    } else {
        Err(PhantomError::Security(format!(
            "backend mismatch: step requires '{step_backend}' but '{executed_backend}' executed it \
             (use an explicit handoff action)"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(id: &str, deps: &[&str]) -> PlanStep {
        PlanStep {
            id: id.into(),
            backend: "cli".into(),
            depends_on: deps.iter().map(|d| d.to_string()).collect(),
        }
    }

    #[test]
    fn diamond_dag_respects_dependencies_and_parallelism() {
        let steps = vec![s("a", &[]), s("b", &["a"]), s("c", &["a"]), s("d", &["b", "c"])];
        let waves = schedule_waves(&steps, 2).unwrap();
        assert_eq!(waves[0], vec!["a"]);
        assert_eq!(waves[1], vec!["b", "c"]);
        assert_eq!(waves[2], vec!["d"]);
    }

    #[test]
    fn cycle_is_rejected() {
        let steps = vec![s("a", &["b"]), s("b", &["a"])];
        assert!(schedule_waves(&steps, 2).is_err());
    }

    #[test]
    fn unknown_dependency_is_rejected() {
        assert!(schedule_waves(&[s("a", &["missing"])], 2).is_err());
    }

    #[test]
    fn backend_mismatch_is_typed_error() {
        assert!(enforce_backend("browser", "cli").is_err());
        assert!(enforce_backend("browser", "browser").is_ok());
    }
}
