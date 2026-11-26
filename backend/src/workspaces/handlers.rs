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
    // No `plan`: a client-sent plan is ignored (serde skips unknown fields).
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
    // The plan is never the client's choice: new workspaces start on Free, and only
    // a billing flow may change it later. (Accepting it here let anyone claim "team".)
    .bind("free")
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

/// A workspace in the caller's list, plus whether the caller pinned it.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WorkspaceListItem {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub plan: String,
    pub owner_id: Uuid,
    pub pinned: bool,
}

/// GET /workspaces — the caller's workspaces, pinned ones first (newest pin first).
pub async fn list(State(state): State<AppState>, auth: AuthUser) -> AppResult<Json<Vec<WorkspaceListItem>>> {
    let workspaces = sqlx::query_as::<_, WorkspaceListItem>(
        "SELECT w.id, w.name, w.slug, w.plan, w.owner_id, (wp.user_id IS NOT NULL) AS pinned
         FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         LEFT JOIN workspace_pins wp ON wp.workspace_id = w.id AND wp.user_id = $1
         WHERE wm.user_id = $1 AND w.deleted_at IS NULL
         ORDER BY (wp.user_id IS NOT NULL) DESC, wp.created_at DESC NULLS LAST, w.created_at DESC",
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

#[derive(Debug, Deserialize)]
pub struct UpdateWorkspace {
    pub name: String,
}

/// The caller's role in a workspace that still exists, or Forbidden.
async fn member_role(state: &AppState, workspace_id: Uuid, user_id: Uuid) -> AppResult<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT wm.role
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND w.deleted_at IS NULL",
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_string()))
}

/// PATCH /workspaces/:id — rename. Owners and admins only.
pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateWorkspace>,
) -> AppResult<Json<Workspace>> {
    let role = member_role(&state, id, auth.id).await?;
    if !matches!(role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden("Only owners and admins can rename a workspace".to_string()));
    }
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("name is required".to_string()));
    }
    if name.chars().count() > 120 {
        return Err(AppError::Validation("name must be 120 characters or fewer".to_string()));
    }
    let workspace = sqlx::query_as::<_, Workspace>(
        "UPDATE workspaces SET name = $2, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, name, slug, plan, owner_id",
    )
    .bind(id)
    .bind(name)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_string()))?;
    Ok(Json(workspace))
}

/// DELETE /workspaces/:id — soft-deletes the workspace and every project in it.
/// Owner only, and never the caller's last workspace (the app needs one to land in).
pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let role = member_role(&state, id, auth.id).await?;
    if role != "owner" {
        return Err(AppError::Forbidden("Only the owner can delete a workspace".to_string()));
    }

    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND w.deleted_at IS NULL",
    )
    .bind(auth.id)
    .fetch_one(&state.pool)
    .await?;
    if remaining <= 1 {
        return Err(AppError::Validation("You can't delete your only workspace. Create another one first.".to_string()));
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE projects SET deleted_at = now() WHERE workspace_id = $1 AND deleted_at IS NULL")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE workspaces SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({ "deleted": true })))
}

/// PUT /workspaces/:id/pin — pin for the caller. Any member may pin.
pub async fn pin(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    member_role(&state, id, auth.id).await?;
    sqlx::query("INSERT INTO workspace_pins (user_id, workspace_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(auth.id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "pinned": true })))
}

/// DELETE /workspaces/:id/pin — unpin for the caller.
pub async fn unpin(State(state): State<AppState>, auth: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM workspace_pins WHERE user_id = $1 AND workspace_id = $2")
        .bind(auth.id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "pinned": false })))
}
