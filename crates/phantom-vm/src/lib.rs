//! Isolated-VM / Cloud PC backend (ADR-008).
//!
//! Desktop automation runs inside a separate Windows VM so the user's
// foreground session is never touched. This crate defines the typed backend
//! contract and a pool; concrete providers (Hyper-V, Cloud PC) plug in behind
//! [`VmBackend`], and [`MockVmBackend`] keeps CI hermetic.

use anyhow::Result;
use async_trait::async_trait;
use phantom_desktop::Image;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Connection details for a single worker VM. Secrets live in Credential
/// Manager; `credential_target` names the entry rather than holding the value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VmConfig {
    pub id: String,
    pub display_name: String,
    pub provider: VmProvider,
    pub host: String,
    pub port: u16,
    pub credential_target: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VmProvider {
    /// Local Hyper-V VM driven through its guest agent / RDP.
    HyperV,
    /// Windows 365 Cloud PC.
    CloudPc,
    /// In-memory backend for CI and unit tests.
    Mock,
}

/// One acquired VM session. Dropping it returns the lease to the pool.
pub struct VmLease {
    inner: Arc<dyn VmBackend>,
    config: VmConfig,
    pool: Arc<Mutex<VecDeque<VmConfig>>>,
}

impl VmLease {
    pub fn id(&self) -> &str {
        &self.config.id
    }

    pub async fn open(&self, target: &str) -> Result<()> {
        self.inner.open(target).await
    }
    pub async fn click(&self, x: i32, y: i32) -> Result<()> {
        self.inner.click(x, y).await
    }
    pub async fn type_text(&self, text: &str) -> Result<()> {
        self.inner.type_text(text).await
    }
    pub async fn screenshot(&self) -> Result<Image> {
        self.inner.screenshot().await
    }
}

impl Drop for VmLease {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        let config = self.config.clone();
        // Return the lease synchronously via try_lock; the pool is only used
        // for bookkeeping so a contended lock can be skipped safely.
        if let Ok(mut q) = pool.try_lock() {
            q.push_back(config);
        };
    }
}

#[async_trait]
pub trait VmBackend: Send + Sync {
    async fn open(&self, target: &str) -> Result<()>;
    async fn click(&self, x: i32, y: i32) -> Result<()>;
    async fn type_text(&self, text: &str) -> Result<()>;
    async fn screenshot(&self) -> Result<Image>;
}

/// A hermetic backend: records calls and returns a valid PNG-shaped image.
pub struct MockVmBackend {
    calls: Mutex<Vec<String>>,
}

impl MockVmBackend {
    pub fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
        }
    }
    pub async fn call_log(&self) -> Vec<String> {
        self.calls.lock().await.clone()
    }
}

#[async_trait]
impl VmBackend for MockVmBackend {
    async fn open(&self, target: &str) -> Result<()> {
        self.calls.lock().await.push(format!("open:{target}"));
        Ok(())
    }
    async fn click(&self, x: i32, y: i32) -> Result<()> {
        self.calls.lock().await.push(format!("click:{x},{y}"));
        Ok(())
    }
    async fn type_text(&self, text: &str) -> Result<()> {
        self.calls.lock().await.push(format!("type:{text}"));
        Ok(())
    }
    async fn screenshot(&self) -> Result<Image> {
        self.calls.lock().await.push("screenshot".into());
        Ok(Image {
            bytes: b"\x89PNG\r\n\x1a\n".to_vec(),
            mime: "image/png".into(),
            width: 1920,
            height: 1080,
        })
    }
}

/// Registry of configured VMs and their backends.
pub struct VmPool {
    configs: Arc<Mutex<VecDeque<VmConfig>>>,
    backends: Vec<Arc<dyn VmBackend>>,
}

impl VmPool {
    pub fn new(configs: Vec<VmConfig>, backends: Vec<Arc<dyn VmBackend>>) -> Self {
        Self {
            configs: Arc::new(Mutex::new(configs.into())),
            backends,
        }
    }

    pub async fn size(&self) -> usize {
        self.configs.lock().await.len()
    }

    /// Acquire a worker, or `None` when all VMs are leased.
    pub async fn acquire(self: &Arc<Self>) -> Option<VmLease> {
        let config = self.configs.lock().await.pop_front()?;
        let backend = self
            .backends
            .iter()
            .find(|b| Self::supports(b, config.provider))
            .cloned()?;
        Some(VmLease {
            inner: backend,
            config,
            pool: self.configs.clone(),
        })
    }

    fn supports(_backend: &Arc<dyn VmBackend>, provider: VmProvider) -> bool {
        // Mock backend serves Mock configs; concrete providers are selected by
        // their `provider()` in a later increment. For now only Mock is wired.
        provider == VmProvider::Mock
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(id: &str) -> VmConfig {
        VmConfig {
            id: id.into(),
            display_name: id.into(),
            provider: VmProvider::Mock,
            host: "127.0.0.1".into(),
            port: 3389,
            credential_target: "phantom/vm/test".into(),
        }
    }

    #[tokio::test]
    async fn lease_is_returned_to_pool_on_drop() {
        let backend = Arc::new(MockVmBackend::new());
        let pool = Arc::new(VmPool::new(vec![cfg("vm-1")], vec![backend.clone()]));
        assert_eq!(pool.size().await, 1);
        {
            let lease = pool.acquire().await.expect("lease");
            assert_eq!(lease.id(), "vm-1");
            assert_eq!(pool.size().await, 0);
            lease.click(10, 20).await.unwrap();
        }
        assert_eq!(pool.size().await, 1);
        assert!(backend.call_log().await.contains(&"click:10,20".to_string()));
    }

    #[tokio::test]
    async fn acquire_returns_none_when_exhausted() {
        let backend = Arc::new(MockVmBackend::new());
        let pool = Arc::new(VmPool::new(vec![cfg("vm-1")], vec![backend]));
        let _lease = pool.acquire().await.expect("first lease");
        assert!(pool.acquire().await.is_none());
    }

    #[tokio::test]
    async fn mock_capture_is_png() {
        let backend = MockVmBackend::new();
        let img = backend.screenshot().await.unwrap();
        assert!(img.is_png());
        assert_eq!((img.width, img.height), (1920, 1080));
    }
}
