use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{asset_pipeline, cleanup, error::{WorkerError, WorkerResult}, export_pipeline, queue::Job};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum JobPayload {
    ExtractMetadata { asset_id: Uuid, input_url: String, idempotency_key: String },
    GenerateProxy { asset_id: Uuid, input_url: String, idempotency_key: String },
    GenerateThumbnails { asset_id: Uuid, input_url: String, idempotency_key: String },
    ExtractWaveform { asset_id: Uuid, input_url: String, idempotency_key: String },
    RenderExport { export_id: Uuid, project_id: Uuid, idempotency_key: String },
    CleanupExpiredFiles { run_id: Uuid },
}

#[derive(Clone)]
pub struct Processor {
    pool: PgPool,
}

impl Processor {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn process(&self, job: &Job) -> WorkerResult<()> {
        let payload: JobPayload = serde_json::from_value(job.payload.clone())
            .map_err(|err| WorkerError::InvalidPayload(err.to_string()))?;
        match payload {
            JobPayload::ExtractMetadata { asset_id, input_url, .. } => asset_pipeline::extract_metadata(&self.pool, asset_id, &input_url).await,
            JobPayload::GenerateProxy { asset_id, input_url, .. } => asset_pipeline::generate_proxy(&self.pool, asset_id, &input_url).await,
            JobPayload::GenerateThumbnails { asset_id, input_url, .. } => asset_pipeline::generate_thumbnails(&self.pool, asset_id, &input_url).await,
            JobPayload::ExtractWaveform { asset_id, input_url, .. } => asset_pipeline::extract_waveform(&self.pool, asset_id, &input_url).await,
            JobPayload::RenderExport { export_id, project_id, .. } => export_pipeline::render_export(&self.pool, export_id, project_id).await,
            JobPayload::CleanupExpiredFiles { run_id } => cleanup::run_daily_cleanup(&self.pool, run_id).await.map(|_| ()),
        }
    }
}
