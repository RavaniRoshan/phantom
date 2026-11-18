//! B2 — Phantom Windows GUI shell (Tauri 2).
//!
//! Thin client: every action goes to the daemon-owned control plane, so tasks
//! keep running when the window is closed. The tray keeps a lightweight handle.

use phantom_control::{ApprovalDecision, Settings, SubmitTask, TaskRecord, VmStatus};
use serde::Serialize;
use tauri::{
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

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
            vm_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Phantom");
}
