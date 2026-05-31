use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub async fn workspace_role_for_project(pool: &PgPool, project_id: Uuid, user_id: Uuid) -> AppResult<String> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT wm.role
         FROM projects p
         JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
         WHERE p.id = $1 AND p.deleted_at IS NULL AND wm.user_id = $2",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    role.ok_or_else(|| AppError::Forbidden("You do not have access to this project".to_string()))
}

pub fn require_editor(role: &str) -> AppResult<()> {
    match role {
        "owner" | "admin" | "editor" => Ok(()),
        _ => Err(AppError::Forbidden("You do not have editor access to this project".to_string())),
    }
}

pub async fn insert_operation(
    tx: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    user_id: Uuid,
    operation_type: &str,
    payload: serde_json::Value,
    client_seq: Option<i64>,
) -> AppResult<i64> {
    let server_seq = sqlx::query_scalar::<_, i64>("SELECT nextval('operation_server_seq')")
        .fetch_one(&mut **tx)
        .await?;

    sqlx::query(
        "INSERT INTO operation_logs (project_id, user_id, operation_type, payload, client_seq, server_seq)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(operation_type)
    .bind(payload)
    .bind(client_seq)
    .bind(server_seq)
    .execute(&mut **tx)
    .await?;

    Ok(server_seq)
}
