//! Local webhook receiver (Pillar I.1).
//!
//! An `axum` HTTP server bound to the **loopback** only (`127.0.0.1`), so the
//! daemon is never reachable from the network. External triggers (Zapier/Make/
//! IFTTT) reach it through a secure tunnel (ngrok / Cloudflare Tunnels) run by
//! the user — that tunnel, not this server, is the exposure boundary.

use crate::bus::EventTx;
use crate::event::{PhantomEvent, WebhookPayload};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use std::net::SocketAddr;
use tokio::sync::broadcast;

/// Run the webhook server until `shutdown` fires.
pub async fn serve(
    tx: EventTx,
    port: u16,
    mut shutdown: broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/event", post(post_event))
        .with_state(tx);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("webhook listening on http://{addr} (loopback only)");

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

/// Liveness probe.
async fn health() -> &'static str {
    "ok"
}

/// Receive a proactive trigger. Returns `202 Accepted` on enqueue, `400` for
/// malformed JSON, `503` if the bus is closed (daemon shutting down).
async fn post_event(State(tx): State<EventTx>, Json(payload): Json<WebhookPayload>) -> StatusCode {
    match tx.send(PhantomEvent::Webhook(payload)).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
