//! Guest agent binary — run at user logon inside the VM, never as a service.

use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let token = std::env::var("PHANTOM_GUEST_TOKEN").unwrap_or_else(|_| "phantom-guest-dev".into());
    let state = Arc::new(phantom_guest::GuestState::new(token));
    let addr: std::net::SocketAddr = "0.0.0.0:8787".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("phantom-guest listening on {addr} (interactive session required)");
    axum::serve(listener, phantom_guest::router(state)).await?;
    Ok(())
}
