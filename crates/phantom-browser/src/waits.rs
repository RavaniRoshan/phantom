//! W2.2 — bounded readiness waits (no unbounded page polling).

use std::future::Future;
use std::time::Duration;

/// Poll `condition` until it returns true or `timeout` elapses.
pub async fn wait_until<F, Fut>(mut condition: F, timeout: Duration) -> anyhow::Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<bool>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if condition().await? {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("condition not met within {}ms", timeout.as_millis());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// A page-readiness check: document present and not `about:blank`.
pub async fn wait_for_page<F, Fut>(url: &str, ready: F) -> anyhow::Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<bool>>,
{
    if url == "about:blank" {
        return Ok(());
    }
    wait_until(ready, Duration::from_secs(10)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn wait_until_succeeds_when_condition_turns_true() {
        let n = AtomicUsize::new(0);
        wait_until(
            || {
                n.fetch_add(1, Ordering::SeqCst);
                async { Ok(n.load(Ordering::SeqCst) >= 3) }
            },
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert!(n.load(Ordering::SeqCst) >= 3);
    }

    #[tokio::test]
    async fn wait_until_times_out() {
        let result = wait_until(|| async { Ok(false) }, Duration::from_millis(150)).await;
        assert!(result.is_err());
    }
}
