//! Filesystem watcher (Pillar I.2).
//!
//! Hooks the OS with `notify` (which uses `ReadDirectoryChangesW` on Windows)
//! to detect files dropped into the Inbox directory, emitting a
//! [`PhantomEvent::FileDropped`] for each. The daemon parses the file type and
//! the engine turns it into a task prompt (e.g. "Summarize this newly dropped
//! PDF").

use crate::bus::EventTx;
use crate::event::PhantomEvent;
use notify::{Event as NotifyEvent, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use tokio::sync::broadcast;

/// Resolve the Inbox directory: explicit override, else `~/Phantom/Inbox`.
pub fn inbox_dir(override_inbox: Option<PathBuf>) -> PathBuf {
    match override_inbox {
        Some(p) => p,
        None => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join("Phantom").join("Inbox")
        }
    }
}

/// Watch `inbox` for newly created/modified files until `shutdown` fires.
pub async fn serve(
    tx: EventTx,
    inbox: PathBuf,
    mut shutdown: broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(&inbox)?;
    tracing::info!("watching inbox: {}", inbox.display());

    // The notify callback runs on the crate's own thread; it pushes events over
    // a `blocking_send` (the mpsc Sender is cheap to clone and is `Sync`).
    let producer = tx.clone();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |res: notify::Result<NotifyEvent>| {
        if let Ok(ev) = res {
            for path in ev.paths.iter() {
                if path.is_file() {
                    let _ = producer.blocking_send(PhantomEvent::FileDropped(path.clone()));
                }
            }
        }
    })?;
    watcher.watch(&inbox, RecursiveMode::NonRecursive)?;

    // Keep the watcher alive and run until shutdown. Dropping `watcher` at the
    // end of scope unwatches the directory.
    tokio::select! {
        _ = shutdown.recv() => {
            tracing::info!("watcher shutting down");
        }
    }
    drop(watcher);
    Ok(())
}
