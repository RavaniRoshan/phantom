use phantom_browser::BrowserBackend;
use phantom_proto::ActionResponse;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

/// Best-effort detection of a usable Chromium/Chrome binary.
///
/// Honors `PHANTOM_CHROME`/`CHROME` (explicit path) and falls back to probing
/// common executable names on `PATH`. Used to skip the e2e test gracefully when
/// no browser is installed (e.g. a bare CI runner without Chromium).
fn chromium_available() -> bool {
    for env in ["PHANTOM_CHROME", "CHROME"] {
        if let Ok(p) = std::env::var(env) {
            if !p.trim().is_empty() && Path::new(p.trim()).exists() {
                return true;
            }
        }
    }
    for name in [
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
        "chrome",
    ] {
        if Command::new(name)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

#[tokio::test]
async fn test_browser_navigate_and_screenshot() {
    if !chromium_available() {
        eprintln!("skipping browser e2e: no Chromium/Chrome binary found");
        return;
    }

    let backend = BrowserBackend::launch()
        .await
        .expect("failed to launch browser");

    let mut params = HashMap::new();
    params.insert("url".to_string(), "https://example.com".to_string());

    let nav_action = ActionResponse {
        action_type: "browser".to_string(),
        action: "navigate".to_string(),
        params,
        reasoning: "navigating to example.com".to_string(),
        confidence: 1.0,
    };

    let result = backend
        .execute(&nav_action)
        .await
        .expect("failed to execute navigate action");
    assert!(result.context.contains("Example Domain"));
    assert!(
        !result.screenshot.is_empty(),
        "Screenshot should not be empty"
    );

    backend.close().await.expect("failed to close browser");
}
