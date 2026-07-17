//! Master Planner swarm runner (V3 Phase C).
//!
//! Drives [`phantom_core::MasterPlanner`]: decompose a task into a sub-task
//! graph, fan the sub-tasks out across concurrent workers, and synthesize a
//! final summary. Unlike `headless_task` (single linear agent), this exercises
//! the swarm path.
//!
//! It runs end-to-end on **any** platform against the offline `mock` provider —
//! no API key, no Windows needed:
//!
//!   PHANTOM_PROVIDER=mock python -m phantom_llm.server   # in another shell
//!   cargo run -p phantom-core --example swarm_task -- "read the report file and summarize it"
//!
//! Usage:
//!   swarm_task[.exe] "<task>" [grpc-endpoint]

use phantom_core::{Config, MasterPlanner, Mode, PhantomClient};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let task = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "Read the report file and summarize it".to_string());
    let endpoint = args
        .get(2)
        .cloned()
        .unwrap_or_else(|| "http://127.0.0.1:50051".to_string());

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    println!(">> task    : {task}");
    println!(">> connect : {endpoint}");

    let client = PhantomClient::connect(&endpoint).await?;
    let config = Config {
        mode: Mode::Hero,
        max_iterations: 8,
        max_parallel_workers: 4,
        ..Config::default()
    };

    let planner = MasterPlanner::new(config, client);
    println!(">> workers : up to {} in parallel", planner.max_parallel());

    let (tx, mut rx) = mpsc::channel::<phantom_core::stream::AgentEvent>(128);
    let handle = tokio::spawn(async move { planner.run(&task, tx).await });

    while let Some(ev) = rx.recv().await {
        use phantom_core::stream::AgentEvent::*;
        match ev {
            Plan(steps) => {
                println!("PLAN ({} subtask(s)):", steps.len());
                for s in &steps {
                    println!("  {}. [{}] {}", s.order, s.backend, s.description);
                }
            }
            Thinking(c) => println!("… {}", c.text),
            Action(a) => println!("ACTION {}/{}: {}", a.action_type, a.action, a.reasoning),
            Result(r) => println!("\n=== RESULT ===\n{r}"),
            Error(e) => println!("ERROR: {e}"),
            Screenshot(bytes) => println!("SCREENSHOT: {} bytes", bytes.len()),
        }
    }

    match handle.await {
        Ok(Ok(())) => {
            println!(">> swarm finished");
            Ok(())
        }
        Ok(Err(e)) => {
            eprintln!(">> swarm error: {e}");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!(">> swarm panicked: {e}");
            std::process::exit(1);
        }
    }
}
