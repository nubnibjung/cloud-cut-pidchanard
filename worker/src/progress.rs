use sqlx::PgPool;
use uuid::Uuid;

use crate::error::WorkerResult;

pub async fn update(pool: &PgPool, export_id: Uuid, progress_percent: i32, status: &str) -> WorkerResult<()> {
    sqlx::query(
        "UPDATE export_jobs SET progress_percent = $2, status = $3, updated_at = now() WHERE id = $1",
    )
    .bind(export_id)
    .bind(progress_percent.clamp(0, 100))
    .bind(status)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_export_progress(pool: &PgPool, export_id: Uuid, progress_percent: i32) -> WorkerResult<()> {
    sqlx::query("UPDATE export_jobs SET progress_percent = $2, updated_at = now() WHERE id = $1")
        .bind(export_id)
        .bind(progress_percent.clamp(0, 100))
        .execute(pool)
        .await?;
    Ok(())
}
