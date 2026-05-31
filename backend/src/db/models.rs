use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub settings: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Track {
    pub id: Uuid,
    pub project_id: Uuid,
    #[serde(rename = "type")]
    pub track_type: String,
    pub label: String,
    pub order_index: i32,
    pub is_locked: bool,
    pub is_muted: bool,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Clip {
    pub id: Uuid,
    pub project_id: Uuid,
    pub track_id: Uuid,
    pub asset_id: Uuid,
    pub name: String,
    pub track_position_ms: i32,
    pub in_point_ms: i32,
    pub out_point_ms: i32,
    pub duration_ms: i32,
    pub transform: Value,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ClipEffect {
    pub id: Uuid,
    pub clip_id: Uuid,
    #[serde(rename = "type")]
    pub effect_type: String,
    pub order_index: i32,
    pub params: Value,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineDocument {
    pub project: Project,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
    pub effects: Vec<ClipEffect>,
}
