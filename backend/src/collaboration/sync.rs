use axum::{extract::{Path, Query, State}, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{app::AppState, auth::jwt::AuthUser, db::queries::workspace_role_for_project, error::AppResult};

#[derive(Debug, Deserialize)]
pub struct OperationQuery {
    #[serde(rename = "afterSeq")]
    after_seq: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OperationDto {
    id: Uuid,
    project_id: Uuid,
    user_id: Uuid,
    operation_type: String,
    payload: Value,
    server_seq: i64,
}

pub async fn operations_after(State(state): State<AppState>, auth: AuthUser, Path(project_id): Path<Uuid>, Query(query): Query<OperationQuery>) -> AppResult<Json<Vec<OperationDto>>> {
    workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    let operations = sqlx::query_as::<_, OperationDto>(
        "SELECT id, project_id, user_id, operation_type, payload, server_seq
         FROM operation_logs
         WHERE project_id = $1 AND server_seq > $2
         ORDER BY server_seq
         LIMIT 500",
    )
    .bind(project_id)
    .bind(query.after_seq)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(operations))
}
