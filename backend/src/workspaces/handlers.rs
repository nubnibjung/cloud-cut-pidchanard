use axum::{extract::{Path, State}, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{app::AppState, auth::jwt::AuthUser, error::{AppError, AppResult}};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub plan: String,
    pub owner_id: Uuid,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WorkspaceMember {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkspace {
    pub name: String,
    pub slug: String,
    pub plan: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InviteMember {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRole {
    pub role: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<CreateWorkspace>,
) -> AppResult<Json<Workspace>> {
    if input.name.trim().is_empty() || input.slug.trim().is_empty() {
        return Err(AppError::Validation("name and slug are required".to_string()));
    }
    let mut tx = state.pool.begin().await?;
    let workspace = sqlx::query_as::<_, Workspace>(
        "INSERT INTO workspaces (name, slug, plan, owner_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, plan, owner_id",
    )
    .bind(&input.name)
    .bind(&input.slug)
    .bind(input.plan.as_deref().unwrap_or("free"))
    .bind(auth.id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace.id)
    .bind(auth.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(workspace))
}

pub async fn list(State(state): State<AppState>, auth: AuthUser) -> AppResult<Json<Vec<Workspace>>> {
    let workspaces = sqlx::query_as::<_, Workspace>(
        "SELECT w.id, w.name, w.slug, w.plan, w.owner_id
         FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = $1 AND w.deleted_at IS NULL
         ORDER BY w.created_at DESC",
    )
    .bind(auth.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(workspaces))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Workspace>> {
    sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this workspace".to_string()))?;

    let workspace = sqlx::query_as::<_, Workspace>(
        "SELECT id, name, slug, plan, owner_id FROM workspaces WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_string()))?;

    Ok(Json(workspace))
}

pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<WorkspaceMember>>> {
    sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this workspace".to_string()))?;

    let members = sqlx::query_as::<_, WorkspaceMember>(
        "SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, u.email, u.name
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1
         ORDER BY wm.created_at",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(members))
}

pub async fn invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<InviteMember>,
) -> AppResult<Json<serde_json::Value>> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this workspace".to_string()))?;

    if !matches!(role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden("Only owners and admins can invite members".to_string()));
    }
    if !matches!(input.role.as_str(), "admin" | "editor" | "viewer") {
        return Err(AppError::Validation("Invalid role. Must be admin, editor, or viewer".to_string()));
    }

    let token = Uuid::new_v4().to_string();
    let expires_at = chrono::Utc::now() + chrono::Duration::days(7);

    sqlx::query(
        "INSERT INTO invitations (workspace_id, email, role, token, expires_at, status)
         VALUES ($1, lower($2), $3, $4, $5, 'pending')
         ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(&input.email)
    .bind(&input.role)
    .bind(&token)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({ "invited": true, "email": input.email, "token": token })))
}

pub async fn update_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((workspace_id, user_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateMemberRole>,
) -> AppResult<Json<serde_json::Value>> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(workspace_id)
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this workspace".to_string()))?;

    if !matches!(role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden("Only owners and admins can update member roles".to_string()));
    }
    if !matches!(input.role.as_str(), "admin" | "editor" | "viewer") {
        return Err(AppError::Validation("Invalid role".to_string()));
    }

    sqlx::query(
        "UPDATE workspace_members SET role = $3, updated_at = now()
         WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(&input.role)
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({ "updated": true })))
}

pub async fn remove_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((workspace_id, user_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let caller_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(workspace_id)
    .bind(auth.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this workspace".to_string()))?;

    if !matches!(caller_role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden("Only owners and admins can remove members".to_string()));
    }

    let target_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;

    if target_role.as_deref() == Some("owner") {
        return Err(AppError::Forbidden("Cannot remove the workspace owner".to_string()));
    }

    sqlx::query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2")
        .bind(workspace_id)
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({ "removed": true })))
}
