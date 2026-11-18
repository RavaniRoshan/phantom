//! B4 — host-side client for the in-guest control agent (ADR-010).

use anyhow::{bail, Result};
use async_trait::async_trait;
use phantom_desktop::Image;
use serde::Serialize;

use crate::VmBackend;

#[derive(Debug, Clone)]
pub struct GuestConfig {
    pub base_url: String,
    pub token: String,
    pub image_width: u32,
    pub screen_width: u32,
}

#[derive(Clone)]
pub struct GuestBackend {
    cfg: GuestConfig,
    client: reqwest::Client,
}

impl std::fmt::Debug for GuestBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GuestBackend")
            .field("base_url", &self.cfg.base_url)
            .field("token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Serialize)]
struct Point {
    x: f64,
    y: f64,
    image_width: u32,
    screen_width: u32,
}

#[derive(Serialize)]
struct Text {
    text: String,
}

impl GuestBackend {
    pub fn new(cfg: GuestConfig) -> Self {
        Self {
            cfg,
            client: reqwest::Client::new(),
        }
    }

    async fn post(&self, path: &str, body: impl Serialize) -> Result<()> {
        let resp = self
            .client
            .post(format!("{}{path}", self.cfg.base_url))
            .bearer_auth(&self.cfg.token)
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            bail!("guest returned {}", resp.status());
        }
        Ok(())
    }
}

#[async_trait]
impl VmBackend for GuestBackend {
    async fn open(&self, target: &str) -> Result<()> {
        let resp = self
            .client
            .get(format!("{}/health", self.cfg.base_url))
            .bearer_auth(&self.cfg.token)
            .send()
            .await?;
        if !resp.status().is_success() {
            bail!("guest agent not ready for target '{target}': {}", resp.status());
        }
        Ok(())
    }

    async fn click(&self, x: i32, y: i32) -> Result<()> {
        self.post("/click", Point {
            x: x as f64,
            y: y as f64,
            image_width: self.cfg.image_width,
            screen_width: self.cfg.screen_width,
        })
        .await
    }

    async fn type_text(&self, text: &str) -> Result<()> {
        self.post("/type", Text { text: text.into() }).await
    }

    async fn screenshot(&self) -> Result<Image> {
        let resp = self
            .client
            .get(format!("{}/screenshot", self.cfg.base_url))
            .bearer_auth(&self.cfg.token)
            .send()
            .await?;
        if !resp.status().is_success() {
            bail!("guest screenshot failed: {}", resp.status());
        }
        let mime = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/png")
            .to_string();
        let bytes = resp.bytes().await?.to_vec();
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            bail!("guest returned a non-PNG frame");
        }
        // Dimensions come from the guest header; fall back to decoded header.
        let width = bytes[16..20].try_into().map(u32::from_be_bytes).unwrap_or(0);
        let height = bytes[20..24].try_into().map(u32::from_be_bytes).unwrap_or(0);
        Ok(Image {
            bytes,
            mime,
            width,
            height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_holds_references_not_secrets_in_logs() {
        let cfg = GuestConfig {
            base_url: "http://127.0.0.1:8787".into(),
            token: "secret".into(),
            image_width: 1920,
            screen_width: 1920,
        };
        let b = GuestBackend::new(cfg);
        assert!(format!("{b:?}").contains("127.0.0.1:8787"));
        assert!(!format!("{b:?}").contains("secret"));
    }
}
