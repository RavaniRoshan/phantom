//! Headless browser backend over the Chrome DevTools Protocol (chromiumoxide).
//!
//! `BrowserBackend` wraps a headless Chromium and exposes operations that map
//! directly onto Phantom's neutral action vocabulary (navigate, click, type,
//! extract, screenshot). Each [`execute`](BrowserBackend::execute) call returns
//! a fresh screenshot + page snapshot so the agent loop can observe state.

use chromiumoxide::browser::{Browser, BrowserConfig, HeadlessMode};
use chromiumoxide::layout::Point;
use chromiumoxide::page::ScreenshotParams;
use futures::StreamExt;
use phantom_proto::ActionResponse;
use tokio::task::JoinHandle;

use crate::actions::ActionResult;

/// A headless Chromium session driven over CDP.
pub struct BrowserBackend {
    browser: Browser,
    page: chromiumoxide::Page,
    _handler: JoinHandle<()>,
}

impl BrowserBackend {
    /// Launch a headless Chromium and open a blank page.
    pub async fn launch() -> anyhow::Result<Self> {
        let config = BrowserConfig::builder()
            .headless_mode(HeadlessMode::True)
            .build()
            .map_err(|e| anyhow::anyhow!(e))?;
        let (browser, mut handler) = Browser::launch(config).await?;

        let handler_task = tokio::spawn(async move {
            while let Some(_) = handler.next().await {}
        });

        let page = browser.new_page("about:blank").await?;

        Ok(Self {
            browser,
            page,
            _handler: handler_task,
        })
    }

    /// Navigate to a URL.
    pub async fn navigate(&self, url: &str) -> anyhow::Result<()> {
        self.page.goto(url).await?;
        Ok(())
    }

    /// Click an element matched by CSS selector.
    pub async fn click_selector(&self, selector: &str) -> anyhow::Result<()> {
        self.page.find_element(selector).await?.click().await?;
        Ok(())
    }

    /// Click at viewport coordinates (fallback when no selector is available).
    pub async fn click_point(&self, x: f64, y: f64) -> anyhow::Result<()> {
        self.page.click(Point::new(x, y)).await?;
        Ok(())
    }

    /// Type text into the element matched by `selector` (defaults to body).
    pub async fn type_text(&self, text: &str, selector: Option<&str>) -> anyhow::Result<()> {
        let sel = selector.unwrap_or("body");
        self.page
            .find_element(sel)
            .await?
            .click()
            .await?
            .type_str(text)
            .await?;
        Ok(())
    }

    /// Current page HTML (used as `current_context`).
    pub async fn content(&self) -> anyhow::Result<String> {
        Ok(self.page.content().await?)
    }

    /// Capture a PNG screenshot of the current page.
    pub async fn screenshot(&self) -> anyhow::Result<Vec<u8>> {
        let params = ScreenshotParams::builder().build();
        Ok(self.page.screenshot(params).await?)
    }

    /// Execute one neutral browser action and return the observed state.
    pub async fn execute(&self, action: &ActionResponse) -> anyhow::Result<ActionResult> {
        match action.action.as_str() {
            "navigate" => {
                let url = action
                    .params
                    .get("url")
                    .ok_or_else(|| anyhow::anyhow!("navigate requires 'url'"))?;
                self.navigate(url).await?;
            }
            "click" => {
                let x = action.params.get("x").and_then(|v| v.parse().ok());
                let y = action.params.get("y").and_then(|v| v.parse().ok());
                match (x, y) {
                    (Some(x), Some(y)) => self.click_point(x, y).await?,
                    _ => {
                        let sel = action
                            .params
                            .get("selector")
                            .ok_or_else(|| anyhow::anyhow!("click requires 'selector' or 'x'/'y'"))?;
                        self.click_selector(sel).await?;
                    }
                }
            }
            "type_text" => {
                let text = action
                    .params
                    .get("text")
                    .ok_or_else(|| anyhow::anyhow!("type_text requires 'text'"))?;
                let sel = action.params.get("selector").map(|s| s.as_str());
                self.type_text(text, sel).await?;
            }
            "extract_content" | "screenshot" => {
                // Observation-only actions; state is captured below.
            }
            other => anyhow::bail!("unsupported browser action: {other}"),
        }

        let screenshot = self.screenshot().await?;
        let context = self.content().await.unwrap_or_default();
        Ok(ActionResult { screenshot, context })
    }

    /// Close the browser and stop the handler task.
    pub async fn close(mut self) -> anyhow::Result<()> {
        self.browser.close().await?;
        Ok(())
    }
}
