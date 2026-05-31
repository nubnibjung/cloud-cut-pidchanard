use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
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
pub struct ExportJob {
    pub id: Uuid,
    pub project_id: Uuid,
    pub requested_by: Uuid,
    pub format: String,
    pub resolution: String,
    pub quality: String,
    pub status: String,
    pub progress_percent: i32,
    pub output_url: Option<String>,
    pub error_message: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateExport {
    format: String,
    resolution: String,
    quality: String,
    idempotency_key: String,
}

pub async fn create_export(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(input): Json<CreateExport>,
) -> AppResult<Json<ExportJob>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    if !matches!(input.format.as_str(), "mp4" | "webm") {
        return Err(AppError::Validation("format must be mp4 or webm".to_string()));
    }
    if !matches!(input.resolution.as_str(), "720p" | "1080p" | "4k") {
        return Err(AppError::Validation("resolution must be 720p, 1080p, or 4k".to_string()));
    }
    if !matches!(input.quality.as_str(), "draft" | "standard" | "high") {
        return Err(AppError::Validation("quality must be draft, standard, or high".to_string()));
    }

    let mut tx = state.pool.begin().await?;
    let expires_at = Utc::now() + chrono::Duration::days(7);
    let export = sqlx::query_as::<_, ExportJob>(
        "INSERT INTO export_jobs (project_id, requested_by, format, resolution, quality, status, idempotency_key, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
         ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = export_jobs.updated_at
         RETURNING id, project_id, requested_by, format, resolution, quality, status, progress_percent,
                   output_url, error_message, started_at, completed_at, expires_at, created_at",
    )
    .bind(project_id)
    .bind(auth.id)
    .bind(&input.format)
    .bind(&input.resolution)
    .bind(&input.quality)
    .bind(&input.idempotency_key)
    .bind(expires_at)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO processing_jobs (kind, status, payload, idempotency_key)
         VALUES ('render_export', 'queued', $1, $2)
         ON CONFLICT (idempotency_key) DO NOTHING",
    )
    .bind(json!({
        "kind": "RenderExport",
        "export_id": export.id,
        "project_id": project_id,
        "idempotency_key": input.idempotency_key
    }))
    .bind(format!("export:{}:render", export.id))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(export))
}

pub async fn list_exports(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
) -> AppResult<Json<Vec<ExportJob>>> {
    workspace_role_for_project(&state.pool, project_id, auth.id).await?;

    let exports = sqlx::query_as::<_, ExportJob>(
        "SELECT id, project_id, requested_by, format, resolution, quality, status, progress_percent,
                output_url, error_message, started_at, completed_at, expires_at, created_at
         FROM export_jobs
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 50",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(exports))
}

pub async fn get_export(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(export_id): Path<Uuid>,
) -> AppResult<Json<ExportJob>> {
    let export = sqlx::query_as::<_, ExportJob>(
        "SELECT id, project_id, requested_by, format, resolution, quality, status, progress_percent,
                output_url, error_message, started_at, completed_at, expires_at, created_at
         FROM export_jobs WHERE id = $1",
    )
    .bind(export_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Export not found".to_string()))?;

    workspace_role_for_project(&state.pool, export.project_id, auth.id).await?;

    Ok(Json(export))
}

pub async fn cancel_export(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(export_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let export = sqlx::query_as::<_, ExportJob>(
        "SELECT id, project_id, requested_by, format, resolution, quality, status, progress_percent,
                output_url, error_message, started_at, completed_at, expires_at, created_at
         FROM export_jobs WHERE id = $1",
    )
    .bind(export_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Export not found".to_string()))?;

    let role = workspace_role_for_project(&state.pool, export.project_id, auth.id).await?;
    require_editor(&role)?;

    if !matches!(export.status.as_str(), "queued" | "processing") {
        return Err(AppError::Validation(format!(
            "Cannot cancel export with status '{}'", export.status
        )));
    }

    sqlx::query(
        "UPDATE export_jobs SET status = 'cancelled', updated_at = now() WHERE id = $1",
    )
    .bind(export_id)
    .execute(&state.pool)
    .await?;

    sqlx::query(
        "UPDATE processing_jobs SET status = 'dead_letter', updated_at = now()
         WHERE payload->>'export_id' = $1 AND status IN ('queued', 'processing')",
    )
    .bind(export_id.to_string())
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({ "cancelled": true })))
}
