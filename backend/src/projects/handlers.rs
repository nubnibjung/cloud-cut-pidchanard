use axum::{extract::{Path, Query, State}, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{app::AppState, auth::jwt::AuthUser, db::{models::{Clip, ClipEffect, Project, TimelineDocument, Track}, queries::workspace_role_for_project}, error::{AppError, AppResult}};

#[derive(Debug, Deserialize)]
pub struct ProjectListQuery {
    #[serde(rename = "workspaceId")]
    workspace_id: Uuid,
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProject {
    workspace_id: Uuid,
    name: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProject {
    name: Option<String>,
    description: Option<String>,
    settings: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct Page<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

pub async fn list(State(state): State<AppState>, auth: AuthUser, Query(query): Query<ProjectListQuery>) -> AppResult<Json<Page<Project>>> {
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let projects = sqlx::query_as::<_, Project>(
        "SELECT p.id, p.workspace_id, p.name, p.description, p.settings, p.updated_at
         FROM projects p
         JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
         WHERE p.workspace_id = $1 AND wm.user_id = $2 AND p.deleted_at IS NULL
           AND ($3::text IS NULL OR p.updated_at < $3::timestamptz)
         ORDER BY p.updated_at DESC
         LIMIT $4",
    )
    .bind(query.workspace_id)
    .bind(auth.id)
    .bind(query.cursor)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    let next_cursor = projects.last().map(|project| project.updated_at.to_rfc3339());
    Ok(Json(Page { items: projects, next_cursor }))
}

pub async fn create(State(state): State<AppState>, auth: AuthUser, Json(input): Json<CreateProject>) -> AppResult<Json<Project>> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(input.workspace_id)
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("You do not have access to this workspace".to_string()))?;
    crate::db::queries::require_editor(&role)?;

    let project = sqlx::query_as::<_, Project>(
        "INSERT INTO projects (workspace_id, name, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, workspace_id, name, description, settings, updated_at",
    )
    .bind(input.workspace_id)
    .bind(input.name)
    .bind(input.description)
    .bind(auth.id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(project))
}

pub async fn detail(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<TimelineDocument>> {
    workspace_role_for_project(&state.pool, id, auth.id).await?;
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, workspace_id, name, description, settings, updated_at FROM projects WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    let tracks = sqlx::query_as::<_, Track>(
        "SELECT id, project_id, type AS track_type, label, order_index, is_locked, is_muted, color
         FROM tracks WHERE project_id = $1 ORDER BY order_index",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let clips = sqlx::query_as::<_, Clip>(
        "SELECT id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version
         FROM clips WHERE project_id = $1 AND deleted_at IS NULL ORDER BY track_position_ms",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let effects = sqlx::query_as::<_, ClipEffect>(
        "SELECT ce.id, ce.clip_id, ce.type AS effect_type, ce.order_index, ce.params, ce.enabled
         FROM clip_effects ce JOIN clips c ON c.id = ce.clip_id WHERE c.project_id = $1 ORDER BY ce.order_index",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(TimelineDocument { project, tracks, clips, effects }))
}

pub async fn update(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>, Json(input): Json<UpdateProject>) -> AppResult<Json<Project>> {
    let role = workspace_role_for_project(&state.pool, id, auth.id).await?;
    crate::db::queries::require_editor(&role)?;
    let project = sqlx::query_as::<_, Project>(
        "UPDATE projects SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            settings = COALESCE($4, settings),
            updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, workspace_id, name, description, settings, updated_at",
    )
    .bind(id)
    .bind(input.name)
    .bind(input.description)
    .bind(input.settings)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;
    Ok(Json(project))
}

pub async fn duplicate(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Project>> {
    let role = workspace_role_for_project(&state.pool, id, auth.id).await?;
    crate::db::queries::require_editor(&role)?;

    let original = sqlx::query_as::<_, Project>(
        "SELECT id, workspace_id, name, description, settings, updated_at FROM projects WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    let mut tx = state.pool.begin().await?;

    let dup = sqlx::query_as::<_, Project>(
        "INSERT INTO projects (workspace_id, name, description, settings, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, workspace_id, name, description, settings, updated_at",
    )
    .bind(original.workspace_id)
    .bind(format!("{} (copy)", original.name))
    .bind(original.description)
    .bind(original.settings)
    .bind(auth.id)
    .fetch_one(&mut *tx)
    .await?;

    // Copy tracks
    let tracks = sqlx::query_scalar::<_, uuid::Uuid>(
        "INSERT INTO tracks (project_id, type, label, order_index, is_locked, is_muted, color)
         SELECT $2, type, label, order_index, is_locked, is_muted, color FROM tracks WHERE project_id = $1
         RETURNING id",
    )
    .bind(id)
    .bind(dup.id)
    .fetch_all(&mut *tx)
    .await
    .unwrap_or_default();

    tracing::info!(original_id = %id, dup_id = %dup.id, tracks = tracks.len(), "Duplicated project");

    tx.commit().await?;
    Ok(Json(dup))
}

pub async fn soft_delete(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, id, auth.id).await?;
    crate::db::queries::require_editor(&role)?;
    sqlx::query("UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "deleted": true })))
}
