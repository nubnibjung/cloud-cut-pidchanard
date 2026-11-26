use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::jwt::AuthUser,
    db::queries::{require_editor, workspace_role_for_project},
    error::{AppError, AppResult},
};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Asset {
    pub id: Uuid,
    pub project_id: Uuid,
    pub uploaded_by: Uuid,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub original_url: String,
    pub status: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct PresignedUrlRequest {
    project_id: Uuid,
    filename: String,
    content_type: String,
}

#[derive(Debug, Serialize)]
pub struct PresignedUrlResponse {
    upload_url: String,
    asset_key: String,
    expires_in: u64,
    /// true: PUT the file to `upload_url` (R2), then confirm with `public_url`.
    /// false: no object storage configured; POST the file to /upload instead.
    direct: bool,
    public_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmUpload {
    project_id: Uuid,
    asset_type: String,
    original_url: String,
    idempotency_key: String,
    duration_ms: Option<i64>,
    /// The file name on the user's computer. Stored files are renamed to a UUID,
    /// so without this the editor could only show "344f2c08-….webp".
    original_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AssetCreated {
    asset_id: Uuid,
    status: String,
}

#[derive(Debug, Deserialize)]
pub struct AssetListQuery {
    #[serde(rename = "projectId")]
    project_id: Uuid,
}

pub async fn presigned_url(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<PresignedUrlRequest>,
) -> AppResult<Json<PresignedUrlResponse>> {
    let role = workspace_role_for_project(&state.pool, input.project_id, auth.id).await?;
    require_editor(&role)?;

    // Keep the extension so the stored object is recognisable and served with a sensible type
    let ext = std::path::Path::new(&input.filename)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default();
    let asset_key = format!("uploads/{}/{}{ext}", input.project_id, Uuid::new_v4());

    let Some(r2) = &state.config.r2 else {
        return Ok(Json(PresignedUrlResponse {
            upload_url: String::new(),
            asset_key,
            expires_in: 0,
            direct: false,
            public_url: None,
        }));
    };
    let expires = std::time::Duration::from_secs(3600);
    let upload_url = r2.presign("PUT", &asset_key, expires);
    let public_url = r2.public_url(&asset_key);

    tracing::info!(
        project_id = %input.project_id,
        filename = %input.filename,
        content_type = %input.content_type,
        "Generated presigned upload URL"
    );

    Ok(Json(PresignedUrlResponse {
        upload_url,
        asset_key,
        expires_in: expires.as_secs(),
        direct: true,
        public_url: Some(public_url),
    }))
}

pub async fn confirm_upload(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<ConfirmUpload>,
) -> AppResult<Json<AssetCreated>> {
    let role = workspace_role_for_project(&state.pool, input.project_id, auth.id).await?;
    require_editor(&role)?;

    if !matches!(input.asset_type.as_str(), "video" | "audio" | "image") {
        return Err(AppError::Validation("asset_type must be video, audio, or image".to_string()));
    }
    // The worker opens this URL with ffmpeg, so only accept files in our own storage
    if !crate::storage::is_own_media_url(&state.config, &input.original_url) {
        return Err(AppError::Validation("original_url must point to an uploaded file".to_string()));
    }

    let mut tx = state.pool.begin().await?;

    // If the client already probed the duration, mark ready immediately and skip extraction job
    let (status, mut metadata) = if let Some(ms) = input.duration_ms {
        ("ready", json!({ "duration_ms": ms }))
    } else {
        ("processing", json!({}))
    };
    if let Some(name) = input.original_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        // Keep it short and free of path parts
        let name: String = name.rsplit(['/', '\\']).next().unwrap_or(name).chars().take(200).collect();
        metadata["original_name"] = json!(name);
    }

    let asset_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO assets (project_id, uploaded_by, type, original_url, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id",
    )
    .bind(input.project_id)
    .bind(auth.id)
    .bind(&input.asset_type)
    .bind(&input.original_url)
    .bind(status)
    .bind(&metadata)
    .fetch_one(&mut *tx)
    .await?;

    // Only queue metadata extraction if we don't already have duration
    if input.duration_ms.is_none() {
        sqlx::query(
            "INSERT INTO processing_jobs (kind, status, payload, idempotency_key)
             VALUES ('extract_metadata', 'queued', $1, $2)
             ON CONFLICT (idempotency_key) DO NOTHING",
        )
        .bind(json!({
            "kind": "ExtractMetadata",
            "asset_id": asset_id,
            "input_url": input.original_url,
            "idempotency_key": input.idempotency_key
        }))
        .bind(format!("asset:{asset_id}:metadata"))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(AssetCreated { asset_id, status: status.to_string() }))
}

pub async fn list_assets(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<AssetListQuery>,
) -> AppResult<Json<Vec<Asset>>> {
    workspace_role_for_project(&state.pool, query.project_id, auth.id).await?;

    let assets = sqlx::query_as::<_, Asset>(
        "SELECT id, project_id, uploaded_by, type AS asset_type, original_url, status, metadata
         FROM assets
         WHERE project_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC",
    )
    .bind(query.project_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(assets))
}

pub async fn get_asset(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Asset>> {
    let asset = sqlx::query_as::<_, Asset>(
        "SELECT id, project_id, uploaded_by, type AS asset_type, original_url, status, metadata
         FROM assets WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Asset not found".to_string()))?;

    workspace_role_for_project(&state.pool, asset.project_id, auth.id).await?;

    Ok(Json(asset))
}

pub async fn delete_asset(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let asset = sqlx::query_as::<_, Asset>(
        "SELECT id, project_id, uploaded_by, type AS asset_type, original_url, status, metadata
         FROM assets WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Asset not found".to_string()))?;

    let role = workspace_role_for_project(&state.pool, asset.project_id, auth.id).await?;
    require_editor(&role)?;

    sqlx::query("UPDATE assets SET deleted_at = now(), updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({ "deleted": true })))
}
