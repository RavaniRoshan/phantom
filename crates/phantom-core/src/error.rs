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
