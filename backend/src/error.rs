use axum::{extract::Request, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden")]
    Forbidden(String),
    #[error("Not found")]
    NotFound(String),
    #[error("Validation failed")]
    Validation(String),
    #[error("Database error")]
    Database(#[from] sqlx::Error),
    #[error("Internal server error")]
    Internal(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorBody {
    #[serde(rename = "statusCode")]
    status_code: u16,
    error: String,
    message: String,
    #[serde(rename = "requestId")]
    request_id: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error) = match &self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized"),
            Self::Forbidden(_) => (StatusCode::FORBIDDEN, "Forbidden"),
            Self::NotFound(_) => (StatusCode::NOT_FOUND, "NotFound"),
            Self::Validation(_) => (StatusCode::BAD_REQUEST, "Validation"),
            Self::Database(_) | Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal"),
        };
        let body = ErrorBody {
            status_code: status.as_u16(),
            error: error.to_string(),
            message: self.to_string(),
            request_id: "req_unavailable".to_string(),
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn request_id(req: &Request) -> String {
    req.headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("req_unavailable")
        .to_string()
}
