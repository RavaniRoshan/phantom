mod commands;
mod tui;

use anyhow::Result;
use clap::Parser;
use phantom_core::{Agent, ApprovalQueue, Config, Mode, PhantomClient};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "phantom", about = "Phantom — the invisible background agent")]
struct Cli {
    /// Path to the config file (defaults to ~/.phantom/config.toml).
    #[arg(long, default_value = "")]
    config: String,

    /// Override the operating mode: safe | hero.
    #[arg(long)]
    mode: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    let cfg_path = if cli.config.is_empty() {
        Config::path()
    } else {
        std::path::PathBuf::from(&cli.config)
    };

    let mut config = Config::load(&cfg_path)?;
    if let Some(m) = cli.mode {
        config.mode = m
            .parse::<Mode>()
            .map_err(|e| anyhow::anyhow!(e))?;
    }

    // Shared HITL approval queue (Phase D). Cloned into both the agent (which
    // enqueues uncertain actions) and the TUI (which resolves them).
    let approval = ApprovalQueue::new();

    // Connect and build the agent. If the Python service isn't up yet, start the
    // TUI anyway and surface a warning when the user submits a task.
    let agent = match PhantomClient::connect(&config.grpc_endpoint).await {
        Ok(client) => {
            let mut a = Agent::new(config.clone(), client);
            // Attach the HITL approval queue so the Phase D confidence gate
            // can pause uncertain actions for the operator to approve.
            a.set_approval_queue(Some(approval.clone()));
            Some(a)
        }
        Err(e) => {
            tracing::warn!("LLM service at {} unreachable: {e}", config.grpc_endpoint);
            None
        }
    };

    // Enter raw mode + alternate screen and run the app.
    let mut terminal = tui::init_terminal()?;
    let result = tui::App::new(config, agent, Some(approval.clone())).run(&mut terminal).await;
    tui::restore_terminal(&mut terminal)?;

    if let Err(e) = result {
        eprintln!("phantom error: {e}");
        std::process::exit(1);
    }
    Ok(())
}
