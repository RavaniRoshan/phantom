//! Headless task runner — drives Phantom's `Agent::run` loop without the TUI.
//!
//! This is the glue for the full-stack NVIDIA runtime check. The LLM service
//! (the Python `phantom_llm` gRPC server) is started *separately* and told which
//! provider to use via `PHANTOM_PROVIDER` / `PHANTOM_API_KEY`. This binary just
//! points at its gRPC endpoint, hands it a task, and prints every agent event.
//!
//! On a Windows runner a `desktop`-backend task actually exercises the hidden
//! desktop (CreateDesktopW + UIA) end-to-end, with the NVIDIA model deciding
//! each action from real screenshots.
//!
//! Usage:
//!   headless_task[.exe] "open notepad and type hello" [grpc-endpoint]

use phantom_core::{Agent, Config, Mode, PhantomClient};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let task = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "Open Notepad and type 'hello phantom'.".to_string());
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

    println!(">> task   : {task}");
    println!(">> connect: {endpoint}");

    let client = PhantomClient::connect(&endpoint).await?;
    let mut config = Config::default();
    config.mode = Mode::Hero; // full access for the runtime check
    config.max_iterations = 15;
    let agent = Agent::new(config, client);

    let (tx, mut rx) = mpsc::channel::<phantom_core::stream::AgentEvent>(64);
    let handle = tokio::spawn(async move { agent.run(&task, tx).await });

    let shot_dir = std::env::var("PHANTOM_SHOT_DIR").ok().map(std::path::PathBuf::from);
    if let Some(dir) = &shot_dir {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut shot_idx: usize = 0;

    while let Some(ev) = rx.recv().await {
        match ev {
            phantom_core::stream::AgentEvent::Plan(steps) => {
                println!("PLAN ({} steps):", steps.len());
                for s in &steps {
                    println!("  {}. [{}] {}", s.order, s.backend, s.description);
                }
            }
            phantom_core::stream::AgentEvent::Thinking(c) => println!("… {}", c.text),
            phantom_core::stream::AgentEvent::Action(a) => {
                println!("ACTION: {}/{} params={:?}", a.action_type, a.action, a.params)
            }
            phantom_core::stream::AgentEvent::Result(r) => println!("RESULT: {r}"),
            phantom_core::stream::AgentEvent::Error(e) => println!("ERROR: {e}"),
            phantom_core::stream::AgentEvent::Screenshot(bytes) => {
                println!("SCREENSHOT: {} bytes", bytes.len());
                if let Some(dir) = &shot_dir {
                    let path = dir.join(format!("shot-{shot_idx:02}.bmp"));
                    if std::fs::write(&path, &bytes).is_ok() {
                        println!("  -> wrote {}", path.display());
                    }
                    shot_idx += 1;
                }
            }
        }
    }

    match handle.await {
        Ok(Ok(())) => println!(">> agent finished"),
        Ok(Err(e)) => {
            eprintln!(">> agent error: {e}");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!(">> task panicked: {e}");
            std::process::exit(1);
        }
    }
    Ok(())
}
