use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("Database error")]
    Database(#[from] sqlx::Error),
    #[error("ffmpeg failed: {0}")]
    Ffmpeg(String),
    #[error("Invalid job payload: {0}")]
    InvalidPayload(String),
    #[error("Internal: {0}")]
    Internal(String),
}

pub type WorkerResult<T> = Result<T, WorkerError>;
