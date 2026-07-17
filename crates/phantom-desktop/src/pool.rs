//! Multi-desktop resource pool (V3 Phase B).
//!
//! V2 proved Phantom can run **one** hidden desktop. To execute a Master
//! Planner's sub-task graph in parallel (Phase C), the swarm needs **many**
//! concurrent desktops — one isolated `PhantomWorker_N` per worker. This module
//! manages that pool:
//!
//!   - concurrency is gated by a [`tokio::sync::Semaphore`] sized to
//!     `max_workers`, so at most that many desktops are leased at once;
//!   - desktops are created lazily (only when demand needs a fresh one) and
//!     **reused**: a returned lease pushes its desktop onto an idle stack rather
//!     than tearing it down, so steady-state work reuses a warm pool;
//!   - [`recommended_workers`] derives `max_workers` from available system RAM
//!     (via `sysinfo`), budgeting ~2 GiB per worker (a Chromium instance + its
//!     desktop), so the swarm never oversubscribes the machine.
//!
//! The pool is cross-platform at the type level (it is built on the same
//! `VirtualDesktop` surface the non-Windows stub provides), so the workspace
//! type-checks on Linux; actually acquiring a worker only succeeds on Windows.

use crate::VirtualDesktop;
use anyhow::{anyhow, Result};
use std::ops::Deref;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// RAM budgeted per worker desktop (~one Chromium instance + its desktop).
pub const DEFAULT_RAM_PER_WORKER: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB

/// A pool of hidden desktops, bounded by `max_workers`.
///
/// Clone-cheap: all state is behind `Arc`, so the pool can be shared across the
/// Master Planner and its worker tasks.
#[derive(Clone)]
pub struct DesktopPool {
    sem: Arc<Semaphore>,
    idle: Arc<Mutex<Vec<VirtualDesktop>>>,
    created: Arc<AtomicUsize>,
    max_workers: usize,
}

impl DesktopPool {
    /// Create a pool that will lease at most `max_workers` desktops at once
    /// (clamped to a minimum of 1).
    pub fn new(max_workers: usize) -> Self {
        let max_workers = max_workers.max(1);
        Self {
            sem: Arc::new(Semaphore::new(max_workers)),
            idle: Arc::new(Mutex::new(Vec::new())),
            created: Arc::new(AtomicUsize::new(0)),
            max_workers,
        }
    }

    /// Create a pool sized to the machine: `min(cap, available_RAM / 2GiB)`.
    pub fn with_dynamic_capacity(cap: usize) -> Self {
        Self::new(recommended_workers(DEFAULT_RAM_PER_WORKER, cap))
    }

    /// Maximum number of concurrently-leased desktops.
    pub fn max_workers(&self) -> usize {
        self.max_workers
    }

    /// Total desktops created so far (for diagnostics/tests).
    pub fn created(&self) -> usize {
        self.created.load(Ordering::SeqCst)
    }

    /// Free lease slots available right now (== `max_workers` when idle).
    pub fn available(&self) -> usize {
        self.sem.available_permits()
    }

    /// Acquire a worker desktop, waiting if all `max_workers` are currently
    /// leased. Reuses an idle desktop when one is available, otherwise creates a
    /// fresh `PhantomWorker_N`. The returned [`WorkerLease`] returns the desktop
    /// to the idle pool when dropped.
    pub async fn acquire(&self) -> Result<WorkerLease> {
        let permit = self
            .sem
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| anyhow!("desktop pool is closed"))?;

        // Reuse a warm desktop if one is idle.
        if let Some(desktop) = self.idle.lock().unwrap().pop() {
            return Ok(WorkerLease {
                desktop: Some(desktop),
                idle: self.idle.clone(),
                _permit: permit,
            });
        }

        // Otherwise create a fresh, uniquely-named worker desktop. On failure
        // the permit drops here, freeing the slot for the next caller.
        let n = self.created.fetch_add(1, Ordering::SeqCst) + 1;
        let name = format!("PhantomWorker_{n}");
        let desktop = VirtualDesktop::launch_named(&name).await?;
        Ok(WorkerLease {
            desktop: Some(desktop),
            idle: self.idle.clone(),
            _permit: permit,
        })
    }
}

/// An exclusive lease on a pooled desktop. Deref to the underlying
/// [`VirtualDesktop`] to drive it (`open`, `click`, `type_text`, `screenshot`).
/// Dropping the lease returns the desktop to the pool for reuse and frees the
/// concurrency slot.
pub struct WorkerLease {
    desktop: Option<VirtualDesktop>,
    idle: Arc<Mutex<Vec<VirtualDesktop>>>,
    _permit: OwnedSemaphorePermit,
}

impl WorkerLease {
    /// Borrow the leased desktop.
    pub fn desktop(&self) -> &VirtualDesktop {
        self.desktop.as_ref().expect("lease holds a desktop until drop")
    }
}

impl Deref for WorkerLease {
    type Target = VirtualDesktop;
    fn deref(&self) -> &Self::Target {
        self.desktop()
    }
}

impl Drop for WorkerLease {
    fn drop(&mut self) {
        if let Some(desktop) = self.desktop.take() {
            // Return the warm desktop to the idle stack for reuse. If the mutex
            // is poisoned we simply drop the desktop (its own Drop tears it down).
            if let Ok(mut idle) = self.idle.lock() {
                idle.push(desktop);
            }
        }
    }
}

/// Recommend a worker count from available system memory, capped at `cap` and
/// floored at 1. Budgets `ram_per_worker` bytes per worker.
pub fn recommended_workers(ram_per_worker: u64, cap: usize) -> usize {
    let ram_per_worker = ram_per_worker.max(1);
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let available = sys.available_memory(); // bytes (sysinfo >= 0.30)
    let by_ram = (available / ram_per_worker).max(1) as usize;
    by_ram.min(cap.max(1)).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaling_is_capped_by_configured_max() {
        // 1-byte budget => RAM allows a huge number, so the cap wins.
        assert_eq!(recommended_workers(1, 4), 4);
    }

    #[test]
    fn scaling_floors_at_one_when_ram_is_tiny() {
        // An absurd per-worker budget => at most 1 worker.
        assert_eq!(recommended_workers(u64::MAX, 8), 1);
    }

    #[test]
    fn scaling_never_returns_zero_even_with_zero_cap() {
        assert_eq!(recommended_workers(1, 0), 1);
    }

    #[test]
    fn new_clamps_capacity_to_at_least_one() {
        let pool = DesktopPool::new(0);
        assert_eq!(pool.max_workers(), 1);
        assert_eq!(pool.available(), 1);
    }

    #[test]
    fn new_reports_configured_capacity() {
        let pool = DesktopPool::new(3);
        assert_eq!(pool.max_workers(), 3);
        assert_eq!(pool.available(), 3);
        assert_eq!(pool.created(), 0);
    }

    // On non-Windows the stub `VirtualDesktop::launch_named` bails, so acquire
    // surfaces that error — but the semaphore slot must be released so the pool
    // is reusable (no permit leak on the failure path).
    #[cfg(not(windows))]
    #[tokio::test]
    async fn acquire_errors_on_stub_without_leaking_permits() {
        let pool = DesktopPool::new(2);
        assert!(pool.acquire().await.is_err());
        assert_eq!(pool.available(), 2, "permit must be released on launch failure");
    }
}
