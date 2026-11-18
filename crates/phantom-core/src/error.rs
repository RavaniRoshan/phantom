use thiserror::Error;

/// Errors produced across the Phantom core.
#[derive(Debug, Error)]
pub enum PhantomError {
    #[error("config error: {0}")]
    Config(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("grpc transport error: {0}")]
    Transport(#[from] tonic::transport::Error),

    #[error("grpc status error: {0}")]
    Status(#[from] tonic::Status),

    #[error("serialization error: {0}")]
    Serde(#[from] toml::de::Error),

    #[error("security violation: {0}")]
    Security(String),

    #[error("backend '{0}' is not available on this platform")]
    BackendUnavailable(String),

    #[error("action loop exceeded max iterations ({0})")]
    MaxIterations(u32),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, PhantomError>;

/// W5.5: turn raw transport/status text into actionable UI messages. Never
/// surface a bare gRPC status string to the user.
pub fn friendly_message(err: &str) -> String {
    let e = err.to_ascii_lowercase();
    if e.contains("unavailable") || e.contains("connection refused") || e.contains("connect") {
        "The LLM service is not reachable. Start it with `python -m phantom_llm.server` and retry.".into()
    } else if e.contains("unauthenticated") || e.contains("api key") || e.contains("401") {
        "The provider API key is missing or invalid. Check your key in Settings (Credential Manager).".into()
    } else if e.contains("resource_exhausted") || e.contains("429") || e.contains("quota") {
        "Provider quota/rate limit reached. Wait a moment and retry, or switch providers.".into()
    } else if e.contains("policy") || e.contains("denied") || e.contains("permission") {
        "Blocked by the Safe-mode policy. Switch to Hero mode only if you trust the task.".into()
    } else if e.contains("invalid_argument") || e.contains("validation") {
        "The model returned an invalid action. Retry the task; if it persists, try another provider.".into()
    } else {
        format!("Something went wrong: {err}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_messages_are_actionable() {
        assert!(friendly_message("transport: connection refused").contains("python -m phantom_llm.server"));
        assert!(friendly_message("status: Unauthenticated").contains("Credential Manager"));
        assert!(friendly_message("429 RESOURCE_EXHAUSTED").contains("quota"));
        assert!(friendly_message("policy denial").contains("Safe-mode"));
        assert!(friendly_message("INVALID_ARGUMENT").contains("invalid action"));
    }
}
