use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPayload {
    pub user_id: String,
    pub name: String,
    pub current_time_ms: i32,
    pub active_track_id: Option<String>,
    pub active_clip_id: Option<String>,
}
