use axum::{
    extract::{Multipart, State},
    Json,
};
use serde_json::json;
use std::{fs, io::Write, path::PathBuf};
use uuid::Uuid;

use crate::{app::AppState, auth::jwt::AuthUser, error::{AppError, AppResult}};

// 4 GB limit for video uploads
pub const UPLOAD_LIMIT: usize = 4 * 1024 * 1024 * 1024;

pub async fn upload_file(
    State(state): State<AppState>,
    _auth: AuthUser,
    mut multipart: Multipart,
) -> AppResult<Json<serde_json::Value>> {
    let upload_dir = PathBuf::from("uploads");
    fs::create_dir_all(&upload_dir).ok();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(e.to_string()))?
    {
        let filename = field.file_name().unwrap_or("upload").to_string();
        let ext = PathBuf::from(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_string();

        let key = format!("{}.{}", Uuid::new_v4(), ext);
        let path = upload_dir.join(&key);

        // Stream chunks to disk — avoid loading entire video into memory
        let mut file = fs::File::create(&path).map_err(|e| AppError::Internal(e.into()))?;
        let mut total = 0usize;

        let mut stream = field;
        while let Some(chunk) = stream
            .chunk()
            .await
            .map_err(|e| AppError::Validation(e.to_string()))?
        {
            file.write_all(&chunk).map_err(|e| AppError::Internal(e.into()))?;
            total += chunk.len();
        }

        tracing::info!(key, bytes = total, "File uploaded");

        let base = state.config.storage_public_base_url.trim_end_matches("/uploads");
        let url = format!("{}/uploads/{}", base, key);
        return Ok(Json(json!({ "url": url, "key": key, "size": total })));
    }

    Err(AppError::Validation("No file in request".to_string()))
}
