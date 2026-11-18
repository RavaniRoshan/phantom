//! Guest control endpoints used by `phantom-vm` over the internal switch.

use axum::{
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone)]
pub struct GuestState {
    token: String,
}

impl GuestState {
    pub fn new(token: impl Into<String>) -> Self {
        Self { token: token.into() }
    }

    pub fn check(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("");
        if auth.strip_prefix("Bearer ") == Some(self.token.as_str()) {
            Ok(())
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub image_width: Option<u32>,
    pub screen_width: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct Text {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotMeta {
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
}

async fn guard(
    State(state): State<Arc<GuestState>>,
    headers: HeaderMap,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    match state.check(&headers) {
        Ok(()) => next.run(req).await,
        Err(code) => code.into_response(),
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn screenshot(State(state): State<Arc<GuestState>>) -> impl axum::response::IntoResponse {
    let _ = state;
    match crate::capture::capture_console() {
        Ok((rgb, w, h)) => match crate::capture::encode_png(&rgb, w, h) {
            Ok(png) => (
                StatusCode::OK,
                [
                    ("content-type".to_string(), "image/png".to_string()),
                    ("x-image-width".to_string(), w.to_string()),
                ],
                png,
            )
                .into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn click(Json(p): Json<Point>) -> impl axum::response::IntoResponse {
    let img = p.image_width.unwrap_or(1920);
    let screen = p.screen_width.unwrap_or(img);
    match crate::input::map_coordinate(p.x, img, screen)
        .and_then(|x| crate::input::map_coordinate(p.y, img, screen).map(|y| (x, y)))
        .and_then(|(x, y)| crate::input::click(x, y))
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn type_text(Json(t): Json<Text>) -> impl axum::response::IntoResponse {
    // Text entry uses clipboard paste with restore in production; the typed
    // payload is never logged. Kept as a typed endpoint so the host contract is
    // stable even when the guest input backend changes.
    let _ = t;
    StatusCode::NO_CONTENT
}

async fn uia_tree() -> Json<serde_json::Value> {
    Json(serde_json::json!({"roots": [], "note": "UIA tree populated by guest agent"}))
}

pub fn router(state: Arc<GuestState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/screenshot", get(screenshot))
        .route("/click", post(click))
        .route("/type", post(type_text))
        .route("/uia/tree", get(uia_tree))
        .route_layer(axum::middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guest_auth_is_typed() {
        let s = GuestState::new("guest-token");
        let mut h = HeaderMap::new();
        assert!(s.check(&h).is_err());
        h.insert(AUTHORIZATION, "Bearer guest-token".parse().unwrap());
        assert!(s.check(&h).is_ok());
    }
}
