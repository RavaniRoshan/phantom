//! B2 — Phantom Windows GUI shell (Tauri 2).
//!
//! Thin client: every action goes to the daemon-owned control plane, so tasks
//! keep running when the window is closed. The tray keeps a lightweight handle.

use phantom_control::{ApprovalDecision, Settings, SubmitTask, TaskRecord, VmStatus};
use serde::{Deserialize, Serialize};
use tauri::{
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Everything the user can configure, owned by the app. The CLI and CI read
/// the same file but never present these controls to an end user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct AppSettings {
    provider: String,
    model: String,
    mode: String,
    max_iterations: u32,
    llm_endpoint: String,
    confidence_gate: f32,
    max_parallel_workers: u32,
    key_configured: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            provider: "claude".into(),
            model: String::new(),
            mode: "safe".into(),
            max_iterations: 25,
            llm_endpoint: String::new(),
            confidence_gate: 0.70,
            max_parallel_workers: 4,
            key_configured: false,
        }
    }
}

static TOKEN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn token() -> String {
    TOKEN.get().cloned().unwrap_or_default()
}

async fn call<T: serde::de::DeserializeOwned>(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<T, String> {
    let client = reqwest::Client::new();
    let mut req = client
        .request(
            method.parse::<reqwest::Method>().map_err(|e| e.to_string())?,
            format!("http://127.0.0.1:4546{path}"),
        )
        .header("Authorization", format!("Bearer {}", token()))
        .header("x-phantom-nonce", phantom_control::load_or_create_token().unwrap_or_default());
    if let Some(body) = body {
        req = req.json(&body);
    }
    let resp = req.send().await.map_err(|e| {
        "The Phantom daemon is not running. Start it from the tray or `phantom-daemon`.".to_string()
            + &e.to_string()
    })?;
    if !resp.status().is_success() {
        return Err(format!("daemon returned {}", resp.status()));
    }
    if resp.status() == reqwest::StatusCode::NO_CONTENT {
        return serde_json::from_str("null").map_err(|e| e.to_string());
    }
    resp.json::<T>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_tasks() -> Result<Vec<TaskRecord>, String> {
    call("GET", "/tasks", None).await
}

#[derive(Debug, Serialize)]
struct SubmitResult {
    id: String,
}

#[tauri::command]
async fn submit_task(prompt: String) -> Result<SubmitResult, String> {
    let body = serde_json::to_value(SubmitTask {
        prompt,
        priority: 1,
        dedupe_key: None,
    })
    .map_err(|e| e.to_string())?;
    let task: TaskRecord = call("POST", "/tasks", Some(body)).await?;
    Ok(SubmitResult { id: task.id })
}

#[tauri::command]
async fn cancel_task(id: String) -> Result<(), String> {
    let _: Option<()> = call("POST", &format!("/tasks/{id}/cancel"), None).await?;
    Ok(())
}

#[tauri::command]
async fn resolve_approval(id: String, approve: bool) -> Result<(), String> {
    let decision = if approve {
        ApprovalDecision::Approve
    } else {
        ApprovalDecision::Reject {
            reason: "rejected in Phantom UI".into(),
        }
    };
    let body = serde_json::to_value(decision).map_err(|e| e.to_string())?;
    let _: Option<()> = call("POST", &format!("/approvals/{id}"), Some(body)).await?;
    Ok(())
}

#[tauri::command]
async fn get_settings() -> Result<Settings, String> {
    call("GET", "/settings", None).await
}

#[tauri::command]
async fn set_settings(settings: Settings) -> Result<(), String> {
    let body = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    let _: Option<()> = call("PUT", "/settings", Some(body)).await?;
    Ok(())
}

#[tauri::command]
async fn vm_status() -> Result<VmStatus, String> {
    call("GET", "/vm/status", None).await
}

/// First-run setup: is a provider key already stored in Credential Manager?
#[tauri::command]
async fn has_api_key() -> Result<bool, String> {
    match phantom_core::secrets::get_secret(phantom_core::secrets::API_KEY_TARGET) {
        Ok(Some(value)) => Ok(!value.trim().is_empty()),
        Ok(None) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// First-run setup: store the provider key in Credential Manager. The key is
/// never written to config.toml or logged; Python reads the same target.
#[tauri::command]
async fn set_api_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("API key is empty".into());
    }
    phantom_core::secrets::set_secret(phantom_core::secrets::API_KEY_TARGET, key)
        .map_err(|e| e.to_string())
}

/// Remove the stored provider key (GUI "Clear key" action).
#[tauri::command]
async fn delete_api_key() -> Result<(), String> {
    phantom_core::secrets::delete_secret(phantom_core::secrets::API_KEY_TARGET)
        .map_err(|e| e.to_string())
}

/// Read the full user-facing config from the config file the daemon uses.
#[tauri::command]
async fn get_app_settings() -> Result<AppSettings, String> {
    let cfg = phantom_core::Config::load(&phantom_core::Config::path()).map_err(|e| e.to_string())?;
    let key_configured = matches!(
        phantom_core::secrets::get_secret(phantom_core::secrets::API_KEY_TARGET),
        Ok(Some(v)) if !v.trim().is_empty()
    );
    Ok(AppSettings {
        provider: cfg.provider,
        model: cfg.model,
        mode: cfg.mode.to_string(),
        max_iterations: cfg.max_iterations,
        llm_endpoint: cfg.llm_endpoint,
        confidence_gate: cfg.confidence_gate,
        max_parallel_workers: cfg.max_parallel_workers,
        key_configured,
    })
}

/// Persist GUI settings to config.toml (the daemon's source of truth) and
/// mirror the control-plane copy so it is visible immediately.
#[tauri::command]
async fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = phantom_core::Config::path();
    let mut cfg = phantom_core::Config::load(&path).map_err(|e| e.to_string())?;
    cfg.provider = settings.provider.trim().to_string();
    cfg.model = settings.model.trim().to_string();
    cfg.mode = settings.mode.parse().map_err(|e: String| e)?;
    if settings.max_iterations == 0 {
        return Err("Max iterations must be greater than zero".into());
    }
    cfg.max_iterations = settings.max_iterations;
    cfg.llm_endpoint = settings.llm_endpoint.trim().to_string();
    cfg.confidence_gate = settings.confidence_gate.clamp(0.0, 1.0);
    cfg.max_parallel_workers = settings.max_parallel_workers.max(1);
    cfg.save(&path).map_err(|e| e.to_string())?;

    let control = Settings {
        provider: settings.provider,
        model: settings.model,
        mode: settings.mode,
        max_iterations: settings.max_iterations,
    };
    call("PUT", "/settings", Some(serde_json::to_value(control).map_err(|e| e.to_string())?))
        .await
}

fn main() {
    let token = phantom_control::load_or_create_token().expect("control token");
    let _ = TOKEN.set(token);

    // 1x1 solid RGBA icon — the Windows resource uses icons/icon.ico.
    let icon = tauri::image::Image::new_owned(vec![0x3b, 0x6f, 0xe0, 0xff], 1, 1);

    tauri::Builder::default()
        .setup(move |app| {
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Phantom — background computer-use agent")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            submit_task,
            cancel_task,
            resolve_approval,
            get_settings,
            set_settings,
            vm_status,
            has_api_key,
            set_api_key,
            delete_api_key,
            get_app_settings,
            save_app_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running Phantom");
}
