//! In-process event bus connecting the OS/cloud triggers to the agent engine.
//!
//! A single `mpsc` channel carries [`PhantomEvent`]s from the webhook and
//! filesystem watcher to the [`crate::engine`], which fans them out into agent
//! tasks. The channel is the only coupling between producers (webhook/watcher)
//! and the consumer (engine): producers hold `Sender` clones, the engine holds
//! the `Receiver`, and the daemon closes the bus on shutdown by dropping every
//! `Sender`.

use crate::event::PhantomEvent;
use tokio::sync::mpsc;

/// Sending end of the event bus.
pub type EventTx = mpsc::Sender<PhantomEvent>;
/// Receiving end of the event bus (held by the engine).
pub type EventRx = mpsc::Receiver<PhantomEvent>;

/// Create the event bus with the given bounded capacity.
pub fn channel(cap: usize) -> (EventTx, EventRx) {
    mpsc::channel(cap)
}
