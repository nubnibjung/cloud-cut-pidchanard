pub async fn log_operation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: uuid::Uuid,
    user_id: uuid::Uuid,
    operation_type: &str,
    payload: serde_json::Value,
    client_seq: Option<i64>,
) -> crate::error::AppResult<i64> {
    crate::db::queries::insert_operation(tx, project_id, user_id, operation_type, payload, client_seq).await
}
