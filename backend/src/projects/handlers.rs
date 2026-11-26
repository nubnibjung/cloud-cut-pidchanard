use axum::{extract::{Path, Query, State}, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{app::AppState, auth::jwt::AuthUser, db::{models::{Clip, ClipEffect, Project, TimelineDocument, Track}, queries::workspace_role_for_project}, error::{AppError, AppResult}};

#[derive(Debug, Deserialize)]
pub struct ProjectListQuery {
    #[serde(rename = "workspaceId")]
    workspace_id: Uuid,
    /// Cursor paging (older clients): continue after this `updated_at`.
    cursor: Option<String>,
    /// Numbered paging (1-based). When set, `total` is returned and `cursor` is ignored.
    page: Option<i64>,
    limit: Option<i64>,
    /// Case-insensitive name filter, applied to pinned and unpinned projects alike.
    q: Option<String>,
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
    /// Numbered paging only: unpinned projects matching the filter (pinned ones are extra).
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_size: Option<i64>,
}

/// A project as shown in the list, plus whether the caller pinned it.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProjectListItem {
    id: Uuid,
    workspace_id: Uuid,
    name: String,
    description: Option<String>,
    settings: serde_json::Value,
    updated_at: chrono::DateTime<chrono::Utc>,
    pinned: bool,
}

/// GET /projects?workspaceId=…[&page=N&limit=M][&q=text]
///
/// Pinned projects (the caller's own pins, newest first) lead the response. With
/// `page`, they come on every page and the numbered pages split only the unpinned
/// projects, with `total` for the pager. Without `page`, the older cursor mode is
/// used: pins on the first page only, then unpinned projects newest-first.
pub async fn list(State(state): State<AppState>, auth: AuthUser, Query(query): Query<ProjectListQuery>) -> AppResult<Json<Page<ProjectListItem>>> {
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    // `%text%` with LIKE wildcards in the user's text escaped
    let pattern = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")));
    let numbered = query.page.is_some();
    let page = query.page.unwrap_or(1).max(1);

    let mut items: Vec<ProjectListItem> = Vec::new();
    if numbered || query.cursor.is_none() {
        items = sqlx::query_as::<_, ProjectListItem>(
            "SELECT p.id, p.workspace_id, p.name, p.description, p.settings, p.updated_at, true AS pinned
             FROM projects p
             JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = $2
             JOIN project_pins pp ON pp.project_id = p.id AND pp.user_id = $2
             WHERE p.workspace_id = $1 AND p.deleted_at IS NULL
               AND ($3::text IS NULL OR p.name ILIKE $3)
             ORDER BY pp.created_at DESC",
        )
        .bind(query.workspace_id)
        .bind(auth.id)
        .bind(pattern.as_deref())
        .fetch_all(&state.pool)
        .await?;
    }

    const UNPINNED: &str = "FROM projects p
         JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = $2
         WHERE p.workspace_id = $1 AND p.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM project_pins pp WHERE pp.project_id = p.id AND pp.user_id = $2)
           AND ($3::text IS NULL OR p.name ILIKE $3)";

    if numbered {
        let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) {UNPINNED}"))
            .bind(query.workspace_id)
            .bind(auth.id)
            .bind(pattern.as_deref())
            .fetch_one(&state.pool)
            .await?;
        let rest = sqlx::query_as::<_, ProjectListItem>(&format!(
            "SELECT p.id, p.workspace_id, p.name, p.description, p.settings, p.updated_at, false AS pinned
             {UNPINNED}
             ORDER BY p.updated_at DESC, p.id
             LIMIT $4 OFFSET $5"
        ))
        .bind(query.workspace_id)
        .bind(auth.id)
        .bind(pattern.as_deref())
        .bind(limit)
        .bind((page - 1) * limit)
        .fetch_all(&state.pool)
        .await?;
        items.extend(rest);
        return Ok(Json(Page { items, next_cursor: None, total: Some(total), page: Some(page), page_size: Some(limit) }));
    }

    let rest = sqlx::query_as::<_, ProjectListItem>(&format!(
        "SELECT p.id, p.workspace_id, p.name, p.description, p.settings, p.updated_at, false AS pinned
         {UNPINNED}
           AND ($4::text IS NULL OR p.updated_at < $4::timestamptz)
         ORDER BY p.updated_at DESC
         LIMIT $5"
    ))
    .bind(query.workspace_id)
    .bind(auth.id)
    .bind(pattern.as_deref())
    .bind(query.cursor)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    // A short page is the last page — only offer a cursor when there may be more
    let next_cursor = if rest.len() as i64 >= limit {
        rest.last().map(|project| project.updated_at.to_rfc3339())
    } else {
        None
    };
    items.extend(rest);
    Ok(Json(Page { items, next_cursor, total: None, page: None, page_size: None }))
}

/// PUT /projects/:id/pin — pin for the caller. Anyone who can open the project may pin it.
pub async fn pin(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    workspace_role_for_project(&state.pool, id, auth.id).await?;
    sqlx::query("INSERT INTO project_pins (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(auth.id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "pinned": true })))
}

/// DELETE /projects/:id/pin — unpin for the caller.
pub async fn unpin(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM project_pins WHERE user_id = $1 AND project_id = $2")
        .bind(auth.id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "pinned": false })))
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
    // The four reads are independent, so run them at the same time: opening a
    // project costs one database round trip of latency instead of four.
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, workspace_id, name, description, settings, updated_at FROM projects WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool);

    let tracks = sqlx::query_as::<_, Track>(
        "SELECT id, project_id, type AS track_type, label, order_index, is_locked, is_muted, color
         FROM tracks WHERE project_id = $1 ORDER BY order_index",
    )
    .bind(id)
    .fetch_all(&state.pool);
    let clips = sqlx::query_as::<_, Clip>(
        "SELECT id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version
         FROM clips WHERE project_id = $1 AND deleted_at IS NULL ORDER BY track_position_ms",
    )
    .bind(id)
    .fetch_all(&state.pool);
    let effects = sqlx::query_as::<_, ClipEffect>(
        "SELECT ce.id, ce.clip_id, ce.type AS effect_type, ce.order_index, ce.params, ce.enabled
         FROM clip_effects ce JOIN clips c ON c.id = ce.clip_id WHERE c.project_id = $1 ORDER BY ce.order_index",
    )
    .bind(id)
    .fetch_all(&state.pool);

    let (project, tracks, clips, effects) = tokio::try_join!(project, tracks, clips, effects)?;
    let project = project.ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;
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
