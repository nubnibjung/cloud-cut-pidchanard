use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::WorkerResult;

#[derive(Debug, Serialize)]
pub struct CleanupSummary {
    pub run_id: Uuid,
    pub deleted_projects: u64,
    pub deleted_assets: u64,
    pub deleted_exports: u64,
    pub freed_bytes: i64,
}

pub async fn run_daily_cleanup(pool: &PgPool, run_id: Uuid) -> WorkerResult<CleanupSummary> {
    let projects = sqlx::query("DELETE FROM projects WHERE deleted_at < now() - interval '30 days'")
        .execute(pool)
        .await?
        .rows_affected();
    let exports = sqlx::query("UPDATE export_jobs SET output_url = NULL WHERE expires_at < now() AND output_url IS NOT NULL")
        .execute(pool)
        .await?
        .rows_affected();
    let assets = sqlx::query("DELETE FROM assets WHERE deleted_at < now() - interval '7 days'")
        .execute(pool)
        .await?
        .rows_affected();
    Ok(CleanupSummary { run_id, deleted_projects: projects, deleted_assets: assets, deleted_exports: exports, freed_bytes: 0 })
}
