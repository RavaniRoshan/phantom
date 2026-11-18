//! Local webhook receiver (Pillar I.1, hardened for W0.8).
//!
//! Bound to loopback only (`127.0.0.1`); an external tunnel is the user's
//! exposure boundary. Every POST must now carry a per-install bearer token and
//! a unique nonce. Bodies are capped, requests are rate-limited, and nonces are
//! remembered so a captured request cannot be replayed.

use crate::bus::EventTx;
use crate::event::{PhantomEvent, WebhookPayload};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Router,
};
use serde_json::from_slice;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Maximum accepted request body (W0.8: >1 MiB must be rejected with 413).
const MAX_BODY_BYTES: usize = 64 * 1024;
/// Max requests per rolling minute (loopback-only, so a global counter suffices).
const RATE_LIMIT_PER_MINUTE: u32 = 60;
/// How long a nonce is remembered for replay detection.
const NONCE_TTL: Duration = Duration::from_secs(300);
/// Header carrying the per-request nonce.
const NONCE_HEADER: &str = "x-phantom-nonce";

struct RateLimiter {
    window_start: Instant,
    count: u32,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self {
            window_start: Instant::now(),
            count: 0,
        }
    }
}

impl RateLimiter {
    fn allow(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.window_start) >= Duration::from_secs(60) {
            self.window_start = now;
            self.count = 0;
        }
        self.count += 1;
        self.count <= RATE_LIMIT_PER_MINUTE
    }
}

struct WebhookState {
    tx: EventTx,
    token: String,
    seen: Mutex<HashMap<String, Instant>>,
    rate: Mutex<RateLimiter>,
}

/// Load the per-install bearer token from env or the OS credential store,
/// generating and storing one on first run.
pub fn load_or_create_token() -> anyhow::Result<String> {
    if let Ok(token) = std::env::var("PHANTOM_WEBHOOK_TOKEN") {
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let target = phantom_core::secrets::WEBHOOK_TOKEN_TARGET;
    if let Some(token) = phantom_core::secrets::get_secret(target)? {
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let token = phantom_core::secrets::generate_token();
    if let Err(e) = phantom_core::secrets::set_secret(target, &token) {
        // Off-Windows CI has no credential store; the token is ephemeral there.
        tracing::warn!("could not persist webhook token: {e}");
    }
    Ok(token)
}

/// Run the webhook server until `shutdown` fires.
pub async fn serve(
    tx: EventTx,
    port: u16,
    token: String,
    mut shutdown: broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    let state = Arc::new(WebhookState {
        tx,
        token,
        seen: Mutex::new(HashMap::new()),
        rate: Mutex::new(RateLimiter::default()),
    });
    let app = Router::new()
        .route("/health", get(health))
        .route("/event", post(post_event))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(
        "webhook listening on http://{addr} (loopback only, bearer auth required)"
    );

    let server = axum::serve(listener, app);
    tokio::select! {
        res = server => {
            if let Err(e) = res {
                tracing::error!("webhook server error: {e}");
            }
        }
        _ = shutdown.recv() => {
            tracing::info!("webhook shutting down");
        }
    }
    Ok(())
}

/// Liveness probe — deliberately unauthenticated.
async fn health() -> &'static str {
    "ok"
}

/// Receive an authenticated trigger.
///
/// Status codes: 401 missing/invalid bearer token, 413 body too large (axum
/// body limit), 429 rate limited, 409 replayed nonce, 400 malformed JSON,
/// 202 accepted, 503 bus closed.
async fn post_event(
    State(state): State<Arc<WebhookState>>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    // 1. Authentication — bearer token, constant-time comparison.
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !constant_time_eq(supplied, &state.token) {
        return StatusCode::UNAUTHORIZED;
    }

    // 2. Rate limit.
    {
        let mut rate = match state.rate.lock() {
            Ok(r) => r,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR,
        };
        if !rate.allow() {
            return StatusCode::TOO_MANY_REQUESTS;
        }
    }

    // 3. Replay protection — a nonce is required and may be used only once.
    let nonce = headers
        .get(NONCE_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if nonce.len() < 8 {
        return StatusCode::BAD_REQUEST;
    }
    {
        let mut seen = match state.seen.lock() {
            Ok(s) => s,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR,
        };
        let now = Instant::now();
        seen.retain(|_, t| now.duration_since(*t) < NONCE_TTL);
        if seen.contains_key(nonce) {
            return StatusCode::CONFLICT;
        }
        seen.insert(nonce.to_string(), now);
    }

    // 4. Parse and enqueue.
    let payload: WebhookPayload = match from_slice(&body) {
        Ok(p) => p,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    match state.tx.send(PhantomEvent::Webhook(payload)).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

/// Length-checked constant-time string comparison (no extra dependency).
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_comparison_is_correct() {
        assert!(constant_time_eq("secret", "secret"));
        assert!(!constant_time_eq("secret", "secreT"));
        assert!(!constant_time_eq("secret", "short"));
        assert!(!constant_time_eq("", "x"));
    }

    #[test]
    fn rate_limiter_admits_then_rejects() {
        let mut r = RateLimiter::default();
        for _ in 0..RATE_LIMIT_PER_MINUTE {
            assert!(r.allow());
        }
        assert!(!r.allow());
    }

    #[test]
    fn body_limit_constant_is_at_most_one_mib() {
        assert!(MAX_BODY_BYTES <= 1024 * 1024);
    }
}
