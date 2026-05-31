use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationEvent {
    pub operation_id: String,
    pub operation_type: String,
    pub project_id: String,
    pub user_id: String,
    pub server_seq: i64,
    pub payload: serde_json::Value,
    pub created_at: String,
}
