//! B1 — authenticated local control plane for the Windows GUI.
//!
//! The daemon owns tasks, approvals and events; the GUI is only a client, so
//! background runs survive closing the window. This crate has no dependency on
//! the daemon binary and is fully unit-testable off-Windows.

use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{sse::Event, IntoResponse, Sse},
    routing::{get, post},
    Json, Router,
};
use phantom_core::artifacts::ArtifactStore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::broadcast;

pub const NONCE_HEADER: &str = "x-phantom-nonce";
pub const MAX_SEEN_NONCES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: String,
    pub prompt: String,
    pub status: String,
    pub outcome: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubmitTask {
    pub prompt: String,
    #[serde(default)]
    pub priority: u8,
    #[serde(default)]
    pub dedupe_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub task_id: String,
    pub action: String,
    pub params_hash: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalDecision {
    Approve,
    Reject { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub provider: String,
    pub model: String,
    pub mode: String,
    pub max_iterations: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "gemini".into(),
            model: String::new(),
            mode: "safe".into(),
            max_iterations: 25,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VmStatus {
    pub backend: String,
    pub state: String,
    pub vm_id: String,
}

impl Default for VmStatus {
    fn default() -> Self {
        Self {
            backend: "mock".into(),
            state: "idle".into(),
            vm_id: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ControlEvent {
    TaskCreated { id: String, prompt: String },
    Step { task_id: String, idx: usize, action: String, success: bool },
    Outcome { task_id: String, status: String, summary: String },
    ApprovalNeeded(ApprovalRequest),
    Error { task_id: String, message: String },
    VmStatus(VmStatus),
}

/// Shared state behind the control API.
pub struct ControlState {
    token: String,
    tasks: Mutex<HashMap<String, TaskRecord>>,
    dedupe: Mutex<HashSet<String>>,
    approvals: Mutex<HashMap<String, ApprovalRequest>>,
    settings: Mutex<Settings>,
    vm: Mutex<VmStatus>,
    nonces: Mutex<HashSet<String>>,
    artifacts_root: PathBuf,
    seq: AtomicU64,
    events: broadcast::Sender<ControlEvent>,
}

impl ControlState {
    pub fn new(token: impl Into<String>, artifacts_root: impl Into<PathBuf>) -> Self {
        let (events, _) = broadcast::channel(512);
        Self {
            token: token.into(),
            tasks: Mutex::new(HashMap::new()),
            dedupe: Mutex::new(HashSet::new()),
            approvals: Mutex::new(HashMap::new()),
            settings: Mutex::new(Settings::default()),
            vm: Mutex::new(VmStatus::default()),
            nonces: Mutex::new(HashSet::new()),
            artifacts_root: artifacts_root.into(),
            seq: AtomicU64::new(0),
            events,
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        format!("{}-{}", prefix, self.seq.fetch_add(1, Ordering::SeqCst) + 1)
    }

    fn emit(&self, event: ControlEvent) {
        let _ = self.events.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ControlEvent> {
        self.events.subscribe()
    }

    /// Submit a task. Returns `None` for a duplicate dedupe key.
    pub fn submit(&self, req: SubmitTask) -> Result<Option<TaskRecord>, String> {
        if req.prompt.trim().is_empty() {
            return Err("prompt must not be empty".into());
        }
        if let Some(key) = &req.dedupe_key {
            let mut seen = self.dedupe.lock().unwrap();
            if !seen.insert(key.clone()) {
                return Ok(None);
            }
        }
        let id = self.next_id("task");
        let record = TaskRecord {
            id: id.clone(),
            prompt: req.prompt.clone(),
            status: "queued".into(),
            outcome: String::new(),
            created_at: unix_now(),
        };
        self.tasks.lock().unwrap().insert(id.clone(), record.clone());
        self.emit(ControlEvent::TaskCreated { id, prompt: req.prompt });
        Ok(Some(record))
    }

    pub fn list(&self) -> Vec<TaskRecord> {
        let mut out: Vec<_> = self.tasks.lock().unwrap().values().cloned().collect();
        out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        out
    }

    pub fn get(&self, id: &str) -> Option<TaskRecord> {
        self.tasks.lock().unwrap().get(id).cloned()
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(t) = self.tasks.lock().unwrap().get_mut(id) {
            t.status = "cancelled".into();
            self.emit(ControlEvent::Outcome {
                task_id: id.into(),
                status: "cancelled".into(),
                summary: String::new(),
            });
            true
        } else {
            false
        }
    }

    pub fn record_step(&self, task_id: &str, idx: usize, action: &str, success: bool) {
        self.emit(ControlEvent::Step {
            task_id: task_id.into(),
            idx,
            action: action.into(),
            success,
        });
    }

    pub fn finish(&self, task_id: &str, status: &str, summary: &str) {
        if let Some(t) = self.tasks.lock().unwrap().get_mut(task_id) {
            t.status = status.into();
            t.outcome = summary.into();
        }
        self.emit(ControlEvent::Outcome {
            task_id: task_id.into(),
            status: status.into(),
            summary: summary.into(),
        });
    }

    pub fn request_approval(&self, task_id: &str, action: &str, params_hash: &str, reason: &str) -> ApprovalRequest {
        let req = ApprovalRequest {
            id: self.next_id("approval"),
            task_id: task_id.into(),
            action: action.into(),
            params_hash: params_hash.into(),
            reason: reason.into(),
        };
        self.approvals.lock().unwrap().insert(req.id.clone(), req.clone());
        self.emit(ControlEvent::ApprovalNeeded(req.clone()));
        req
    }

    pub fn resolve_approval(&self, id: &str, decision: &ApprovalDecision) -> bool {
        let removed = self.approvals.lock().unwrap().remove(id);
        if removed.is_some() {
            let status = match decision {
                ApprovalDecision::Approve => "approved",
                ApprovalDecision::Reject { .. } => "rejected",
            };
            self.emit(ControlEvent::Step {
                task_id: removed.unwrap().task_id,
                idx: 0,
                action: format!("approval/{id}"),
                success: status == "approved",
            });
            true
        } else {
            false
        }
    }

    pub fn error(&self, task_id: &str, message: &str) {
        self.emit(ControlEvent::Error {
            task_id: task_id.into(),
            message: message.into(),
        });
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_settings(&self, settings: Settings) {
        *self.settings.lock().unwrap() = settings;
        self.emit(ControlEvent::VmStatus(self.vm()));
    }

    pub fn vm(&self) -> VmStatus {
        self.vm.lock().unwrap().clone()
    }

    pub fn set_vm(&self, vm: VmStatus) {
        *self.vm.lock().unwrap() = vm.clone();
        self.emit(ControlEvent::VmStatus(vm));
    }

    pub fn artifacts(&self, task_id: &str) -> Result<Vec<String>> {
        let store = ArtifactStore::new(&self.artifacts_root);
        Ok(store
            .list(task_id)?
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect())
    }

    /// Constant-time-ish bearer comparison + one-shot nonce replay protection.
    pub fn check_auth(&self, headers: &HeaderMap) -> std::result::Result<(), StatusCode> {
        let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("");
        let provided = auth.strip_prefix("Bearer ").unwrap_or("");
        let expected = self.token.as_bytes();
        let actual = provided.as_bytes();
        let mut diff = expected.len() ^ actual.len();
        for (a, b) in expected.iter().zip(actual.iter()) {
            diff |= (a ^ b) as usize;
        }
        if diff != 0 {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let nonce = headers
            .get(NONCE_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if nonce.is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }
        let mut seen = self.nonces.lock().unwrap();
        if !seen.insert(nonce.to_string()) {
            return Err(StatusCode::CONFLICT);
        }
        if seen.len() > MAX_SEEN_NONCES {
            seen.clear();
            seen.insert(nonce.to_string());
        }
        Ok(())
    }
}

/// Load the per-install GUI control token from env or the OS credential store.
pub fn load_or_create_token() -> Result<String> {
    if let Ok(token) = std::env::var("PHANTOM_CONTROL_TOKEN") {
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let target = phantom_core::secrets::CONTROL_TOKEN_TARGET;
    if let Some(token) = phantom_core::secrets::get_secret(target)? {
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let token = phantom_core::secrets::generate_token();
    if let Err(e) = phantom_core::secrets::set_secret(target, &token) {
        tracing::warn!("could not persist control token: {e}");
    }
    Ok(token)
}

/// Serve the control API on a loopback address until the process exits.
pub async fn serve(state: std::sync::Arc<ControlState>, addr: std::net::SocketAddr) -> Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("control plane listening on {addr}");
    axum::serve(listener, router(state)).await?;
    Ok(())
}

fn unix_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix-{secs}")
}

// ---- handlers ----

async fn submit(State(state): State<std::sync::Arc<ControlState>>, Json(req): Json<SubmitTask>) -> impl IntoResponse {
    match state.submit(req) {
        Ok(Some(task)) => (StatusCode::ACCEPTED, Json(task)).into_response(),
        Ok(None) => (StatusCode::CONFLICT, Json(serde_json::json!({"error": "duplicate task"}))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

async fn list_tasks(State(state): State<std::sync::Arc<ControlState>>) -> Json<Vec<TaskRecord>> {
    Json(state.list())
}

async fn get_task(
    State(state): State<std::sync::Arc<ControlState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.get(&id) {
        Some(t) => (StatusCode::OK, Json(t)).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such task"}))).into_response(),
    }
}

async fn cancel_task(
    State(state): State<std::sync::Arc<ControlState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if state.cancel(&id) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such task"}))).into_response()
    }
}

async fn resolve(
    State(state): State<std::sync::Arc<ControlState>>,
    Path(id): Path<String>,
    Json(decision): Json<ApprovalDecision>,
) -> impl IntoResponse {
    if state.resolve_approval(&id, &decision) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such approval"}))).into_response()
    }
}

async fn artifacts(
    State(state): State<std::sync::Arc<ControlState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.artifacts(&id) {
        Ok(paths) => Json(paths).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

async fn get_settings(State(state): State<std::sync::Arc<ControlState>>) -> Json<Settings> {
    Json(state.settings())
}

async fn put_settings(
    State(state): State<std::sync::Arc<ControlState>>,
    Json(settings): Json<Settings>,
) -> StatusCode {
    state.set_settings(settings);
    StatusCode::NO_CONTENT
}

async fn get_vm(State(state): State<std::sync::Arc<ControlState>>) -> Json<VmStatus> {
    Json(state.vm())
}

async fn put_vm(
    State(state): State<std::sync::Arc<ControlState>>,
    Json(vm): Json<VmStatus>,
) -> StatusCode {
    state.set_vm(vm);
    StatusCode::NO_CONTENT
}

async fn events(State(state): State<std::sync::Arc<ControlState>>) -> Sse<impl futures::Stream<Item = std::result::Result<Event, Infallible>>> {
    let rx = state.subscribe();
    let stream = futures::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let data = serde_json::to_string(&ev).unwrap_or_default();
                    return Some((Ok(Event::default().data(data)), rx));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream)
}

async fn auth_guard(
    State(state): State<std::sync::Arc<ControlState>>,
    headers: HeaderMap,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> impl IntoResponse {
    match state.check_auth(&headers) {
        Ok(()) => next.run(req).await,
        Err(code) => code.into_response(),
    }
}

/// Build the router with authentication on every route.
pub fn router(state: std::sync::Arc<ControlState>) -> Router {
    Router::new()
        .route("/tasks", post(submit).get(list_tasks))
        .route("/tasks/:id", get(get_task))
        .route("/tasks/:id/cancel", post(cancel_task))
        .route("/approvals/:id", post(resolve))
        .route("/artifacts/:id", get(artifacts))
        .route("/events", get(events))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/vm/status", get(get_vm).put(put_vm))
        .route_layer(axum::middleware::from_fn_with_state(state.clone(), auth_guard))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn state() -> std::sync::Arc<ControlState> {
        std::sync::Arc::new(ControlState::new("secret-token", std::env::temp_dir()))
    }

    fn auth(req: Request<Body>, nonce: &str) -> Request<Body> {
        let mut req = req;
        req.headers_mut().insert(AUTHORIZATION, "Bearer secret-token".parse().unwrap());
        req.headers_mut().insert(NONCE_HEADER, nonce.parse().unwrap());
        req
    }

    #[test]
    fn auth_rejects_missing_wrong_and_replayed() {
        let s = state();
        let mut headers = HeaderMap::new();
        assert_eq!(s.check_auth(&headers), Err(StatusCode::UNAUTHORIZED));
        headers.insert(AUTHORIZATION, "Bearer wrong".parse().unwrap());
        headers.insert(NONCE_HEADER, "n1".parse().unwrap());
        assert_eq!(s.check_auth(&headers), Err(StatusCode::UNAUTHORIZED));
        headers.insert(AUTHORIZATION, "Bearer secret-token".parse().unwrap());
        assert_eq!(s.check_auth(&headers), Ok(()));
        assert_eq!(s.check_auth(&headers), Err(StatusCode::CONFLICT));
    }

    #[test]
    fn state_dedupes_and_cancels() {
        let s = state();
        let req = SubmitTask { prompt: "do thing".into(), priority: 1, dedupe_key: Some("k".into()) };
        let first = s.submit(req.clone()).unwrap().unwrap();
        assert!(s.submit(req).unwrap().is_none());
        assert!(s.cancel(&first.id));
        assert_eq!(s.get(&first.id).unwrap().status, "cancelled");
    }

    #[test]
    fn approval_resolution_emits_event() {
        let s = state();
        let mut rx = s.subscribe();
        let ap = s.request_approval("task-1", "cli/run_command", "abc", "low confidence");
        assert!(s.resolve_approval(&ap.id, &ApprovalDecision::Approve));
        assert!(matches!(rx.try_recv(), Ok(ControlEvent::ApprovalNeeded(_))));
    }

    #[tokio::test]
    async fn router_guards_and_serves_tasks() {
        let s = state();
        let app = router(s.clone());
        let unauth = app.clone().oneshot(Request::builder().uri("/tasks").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

        let body = serde_json::to_vec(&SubmitTask { prompt: "hi".into(), priority: 1, dedupe_key: None }).unwrap();
        let resp = app
            .oneshot(auth(Request::builder().method("POST").uri("/tasks").header("content-type", "application/json").body(Body::from(body)).unwrap(), "n-1"))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        assert_eq!(s.list().len(), 1);
    }
}
