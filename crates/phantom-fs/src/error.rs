use thiserror::Error;

/// Errors from the file-system / CLI backend.
#[derive(Debug, Error)]
pub enum FsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("security violation: {0}")]
    Security(String),

    #[error("search error: {0}")]
    Search(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, FsError>;
