use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
