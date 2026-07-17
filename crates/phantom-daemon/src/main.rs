//! Phantom V3 daemon — the proactive context engine.
//!
//! Boots three concurrent tasks and wires them through an in-process event bus:
//!   - `webhook`  : local HTTP receiver for cloud triggers (Pillar I.1)
//!   - `watcher`  : filesystem watcher for dropped files (Pillar I.2)
//!   - `engine`   : turns triggers into agent tasks (reusing `phantom_core::Agent`)
//!
//! The animated mascot window (Pillar I.3) is deferred; this daemon is the
//! headless foundation everything else builds on.

mod bus;
mod engine;
mod event;
mod watcher;
mod webhook;

use bus::channel;
use clap::Parser;
use phantom_core::Config;
use std::path::PathBuf;
use tokio::sync::broadcast;

#[derive(Parser)]
#[command(name = "phantom-daemon", about = "Phantom V3 — proactive context-engine daemon")]
struct Cli {
    /// Path to the config file (defaults to ~/.phantom/config.toml).
    #[arg(long, default_value = "")]
    config: String,
    /// Override the operating mode: safe | hero.
    #[arg(long)]
    mode: Option<String>,
    /// Override the gRPC LLM service address.
    #[arg(long)]
    grpc_endpoint: Option<String>,
    /// Webhook listen port (loopback only).
    #[arg(long, default_value_t = 4545)]
    port: u16,
    /// Override the watched Inbox directory.
    #[arg(long)]
    inbox: Option<PathBuf>,
    /// Log the generated task prompt but do not invoke the LLM.
    #[arg(long)]
    dry_run: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    let cfg_path = if cli.config.is_empty() {
        Config::path()
    } else {
        PathBuf::from(&cli.config)
    };
    let mut config = Config::load(&cfg_path)?;
    if let Some(m) = cli.mode.clone() {
        config.mode = m
            .parse::<phantom_core::Mode>()
            .map_err(|e| anyhow::anyhow!(e))?;
    }
    if let Some(g) = cli.grpc_endpoint {
        config.grpc_endpoint = g;
    }

    let inbox = watcher::inbox_dir(cli.inbox.clone());
    let (tx, rx) = channel(128);

    // Shutdown signal shared with the webhook + watcher tasks.
    let (shutdown_tx, _) = broadcast::channel::<()>(2);
    let webhook_shutdown = shutdown_tx.subscribe();
    let watcher_shutdown = shutdown_tx.subscribe();

    // Producers hold tx clones; the engine holds rx. The original `tx` is
    // dropped immediately so the ONLY senders are the two producer tasks —
    // when they exit on shutdown, the bus closes and the engine's recv() ends
    // (holding the last tx in main would deadlock the engine).
    let webhook_task = tokio::spawn(webhook::serve(tx.clone(), cli.port, webhook_shutdown));
    let watcher_task = tokio::spawn(watcher::serve(tx.clone(), inbox, watcher_shutdown));
    drop(tx);
    let engine_task = tokio::spawn(engine::run(rx, config, cli.dry_run));

    tracing::info!(
        "phantom-daemon started (dry_run={}, mode={:?}) — ctrl_c to stop",
        cli.dry_run,
        cli.mode
    );

    tokio::signal::ctrl_c().await?;
    tracing::info!("shutdown signal received");
    let _ = shutdown_tx.send(());

    // Wait for producers to unwatch/stop, which closes the bus and ends engine.
    let _ = webhook_task.await;
    let _ = watcher_task.await;
    let _ = engine_task.await;
    tracing::info!("phantom-daemon stopped");
    Ok(())
}
