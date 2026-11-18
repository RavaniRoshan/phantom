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

    // Connect once. The client is kept by the TUI so each submitted task gets
    // a FRESH Agent with its own browser/desktop state (W0.14). If the Python
    // service isn't up yet, start the TUI anyway and warn on task submission.
    let client = match PhantomClient::connect(&config.grpc_endpoint).await {
        Ok(c) => Some(c),
        Err(e) => {
            tracing::warn!("LLM service at {} unreachable: {e}", config.grpc_endpoint);
            None
        }
    };
    let agent = client.as_ref().map(|c| {
        let mut a = Agent::new(config.clone(), c.clone());
        a.set_approval_queue(Some(approval.clone()));
        a
    });

    // Enter raw mode + alternate screen and run the app.
    let mut terminal = tui::init_terminal()?;
    let result = tui::App::new(config, agent, client, Some(approval.clone()))
        .run(&mut terminal)
        .await;
    tui::restore_terminal(&mut terminal)?;

    if let Err(e) = result {
        eprintln!("phantom error: {e}");
        std::process::exit(1);
    }
    Ok(())
}
