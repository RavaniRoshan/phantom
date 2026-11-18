//! W0.11 golden-task runner.
//!
//!   cargo run -p phantom-core --example bench
//!
//! Runs the 20 file/CLI tasks locally (deterministic). Desktop/browser tasks
//! are reported as `skipped` unless `PHANTOM_BENCH_LIVE=1` and
//! `PHANTOM_BENCH_ENDPOINT` points at the Python LLM service — then each task
//! is submitted through a real Agent and its success check is evaluated.
//!
//! Env: PHANTOM_BENCH_TASKS, PHANTOM_BENCH_WORKDIR, PHANTOM_BENCH_REPORT,
//!      PHANTOM_BENCH_LIVE, PHANTOM_BENCH_ENDPOINT.

use phantom_core::bench::{self, Backend, GoldenTask, TaskResult};
use phantom_core::{Agent, Config, PhantomClient};
use std::path::PathBuf;

async fn run_live(task: &GoldenTask, workdir: &std::path::Path) -> anyhow::Result<TaskResult> {
    let Some(endpoint) = std::env::var("PHANTOM_BENCH_ENDPOINT").ok() else {
        return Ok(skipped(task, "set PHANTOM_BENCH_ENDPOINT for live tasks"));
    };
    let Ok(client) = PhantomClient::connect(&endpoint).await else {
        return Ok(skipped(task, "LLM service unreachable"));
    };
    let agent = Agent::new(Config::default(), client);
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let prompt = task.prompt.clone();
    let handle = tokio::spawn(async move { agent.run(&prompt, tx).await });
    while rx.recv().await.is_some() {}
    match handle.await {
        Ok(Ok(_)) => Ok(bench::evaluate(task, workdir)),
        Ok(Err(e)) => Ok(TaskResult {
            id: task.id.clone(),
            backend: task.backend,
            passed: false,
            status: "fail".into(),
            reason: format!("agent error: {e}"),
        }),
        Err(e) => Ok(TaskResult {
            id: task.id.clone(),
            backend: task.backend,
            passed: false,
            status: "fail".into(),
            reason: format!("agent panicked: {e}"),
        }),
    }
}

fn skipped(task: &GoldenTask, reason: &str) -> TaskResult {
    TaskResult {
        id: task.id.clone(),
        backend: task.backend,
        passed: false,
        status: "skipped".into(),
        reason: reason.to_string(),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let task_dir = std::env::var("PHANTOM_BENCH_TASKS")
        .map(PathBuf::from)
        .unwrap_or_else(|_| bench::default_task_dir());
    let workdir = std::env::var("PHANTOM_BENCH_WORKDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("phantom-bench"));
    std::fs::create_dir_all(&workdir)?;

    let tasks = bench::load_tasks(&task_dir)?;
    let live = std::env::var("PHANTOM_BENCH_LIVE").ok().as_deref() == Some("1");
    println!(
        "Phantom golden-task harness: {} tasks ({} deterministic, {} live)\n",
        tasks.len(),
        tasks.iter().filter(|t| t.backend == Backend::Files).count(),
        tasks.iter().filter(|t| t.backend != Backend::Files).count()
    );

    let mut results = Vec::new();
    for task in &tasks {
        let result = match task.backend {
            Backend::Files => bench::run_deterministic(task, &workdir)?,
            Backend::Browser | Backend::Desktop if live => run_live(task, &workdir).await?,
            _ => skipped(task, "live backend not enabled (PHANTOM_BENCH_LIVE=1)"),
        };
        println!(
            "[{:>8}] {:<8} {:<14} {}",
            result.status, result.backend, result.id, result.reason
        );
        results.push(result);
    }

    let passed = results.iter().filter(|r| r.passed).count();
    let failed = results.iter().filter(|r| r.status == "fail").count();
    let skipped = results.iter().filter(|r| r.status == "skipped").count();
    println!(
        "\nSummary: {} pass / {} fail / {} skipped (of {})",
        passed,
        failed,
        skipped,
        results.len()
    );

    if let Ok(path) = std::env::var("PHANTOM_BENCH_REPORT") {
        std::fs::write(&path, serde_json::to_string_pretty(&results)?)?;
        println!("Report written to {path}");
    }

    // Deterministic failures are a hard error so CI catches regressions.
    if failed > 0 {
        anyhow::bail!("{failed} golden task(s) failed");
    }
    Ok(())
}
