use axum::{extract::{Path, State}, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::jwt::AuthUser,
    collaboration::pusher,
    db::{
        models::Clip,
        queries::{insert_operation, require_editor, workspace_role_for_project},
    },
    error::{AppError, AppResult},
};

// ─── Clip DTOs ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateClip {
    track_id: Uuid,
    asset_id: Uuid,
    name: String,
    track_position_ms: i32,
    in_point_ms: i32,
    out_point_ms: i32,
    client_seq: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateClip {
    track_id: Option<Uuid>,
    name: Option<String>,
    track_position_ms: Option<i32>,
    in_point_ms: Option<i32>,
    out_point_ms: Option<i32>,
    transform: Option<serde_json::Value>,
    client_seq: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SplitClip {
    at_time_ms: i32,
    client_seq: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BatchClipOp {
    clip_id: Uuid,
    track_position_ms: Option<i32>,
    track_id: Option<Uuid>,
}

// ─── Track DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
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

#[derive(Debug, Deserialize)]
pub struct CreateTrack {
    #[serde(rename = "type")]
    track_type: String,
    label: String,
    order_index: Option<i32>,
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTrack {
    label: Option<String>,
    order_index: Option<i32>,
    is_locked: Option<bool>,
    is_muted: Option<bool>,
    color: Option<String>,
}

// ─── Effect DTOs ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ClipEffect {
    pub id: Uuid,
    pub clip_id: Uuid,
    #[serde(rename = "type")]
    pub effect_type: String,
    pub order_index: i32,
    pub params: serde_json::Value,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateEffect {
    #[serde(rename = "type")]
    effect_type: String,
    params: Option<serde_json::Value>,
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEffect {
    params: Option<serde_json::Value>,
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderEffects {
    effect_ids: Vec<Uuid>,
}

// ─── Transition DTOs ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Transition {
    pub id: Uuid,
    pub project_id: Uuid,
    pub from_clip_id: Uuid,
    pub to_clip_id: Uuid,
    #[serde(rename = "type")]
    pub transition_type: String,
    pub duration_ms: i32,
    pub params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransition {
    from_clip_id: Uuid,
    to_clip_id: Uuid,
    #[serde(rename = "type")]
    transition_type: String,
    duration_ms: i32,
    params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTransition {
    #[serde(rename = "type")]
    transition_type: Option<String>,
    duration_ms: Option<i32>,
    params: Option<serde_json::Value>,
}

// ─── TextOverlay DTOs ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TextOverlay {
    pub id: Uuid,
    pub project_id: Uuid,
    pub track_position_ms: i32,
    pub duration_ms: i32,
    pub content: String,
    pub font_family: String,
    pub font_size: i32,
    pub font_color: String,
    pub position: serde_json::Value,
    pub alignment: String,
    pub animation: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTextOverlay {
    track_position_ms: i32,
    duration_ms: i32,
    content: String,
    font_family: Option<String>,
    font_size: Option<i32>,
    font_color: Option<String>,
    position: Option<serde_json::Value>,
    alignment: Option<String>,
    animation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTextOverlay {
    track_position_ms: Option<i32>,
    duration_ms: Option<i32>,
    content: Option<String>,
    font_family: Option<String>,
    font_size: Option<i32>,
    font_color: Option<String>,
    position: Option<serde_json::Value>,
    alignment: Option<String>,
    animation: Option<String>,
}

// ─── Clip Handlers ────────────────────────────────────────────────────────────

pub async fn create_clip(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(input): Json<CreateClip>,
) -> AppResult<Json<Clip>> {
    if input.out_point_ms <= input.in_point_ms {
        return Err(AppError::Validation("out_point_ms must be greater than in_point_ms".to_string()));
    }
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;
    let duration_ms = input.out_point_ms - input.in_point_ms;
    let mut tx = state.pool.begin().await?;
    let clip = sqlx::query_as::<_, Clip>(
        "INSERT INTO clips (project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version",
    )
    .bind(project_id)
    .bind(input.track_id)
    .bind(input.asset_id)
    .bind(&input.name)
    .bind(input.track_position_ms)
    .bind(input.in_point_ms)
    .bind(input.out_point_ms)
    .bind(duration_ms)
    .fetch_one(&mut *tx)
    .await?;
    let seq = insert_operation(&mut tx, project_id, auth.id, "clip.add", json!({ "clipId": clip.id }), input.client_seq).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "clip-added",
        &json!({ "clip": clip, "serverSeq": seq }),
    ).await;

    Ok(Json(clip))
}

pub async fn update_clip(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateClip>,
) -> AppResult<Json<Clip>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;
    let mut tx = state.pool.begin().await?;
    let clip = sqlx::query_as::<_, Clip>(
        "UPDATE clips SET
            track_id = COALESCE($3, track_id),
            name = COALESCE($4, name),
            track_position_ms = COALESCE($5, track_position_ms),
            in_point_ms = COALESCE($6, in_point_ms),
            out_point_ms = COALESCE($7, out_point_ms),
            duration_ms = COALESCE($7, out_point_ms) - COALESCE($6, in_point_ms),
            transform = COALESCE($8, transform),
            version = version + 1,
            updated_at = now()
         WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version",
    )
    .bind(project_id)
    .bind(clip_id)
    .bind(input.track_id)
    .bind(input.name)
    .bind(input.track_position_ms)
    .bind(input.in_point_ms)
    .bind(input.out_point_ms)
    .bind(input.transform)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Clip not found".to_string()))?;

    let seq = insert_operation(&mut tx, project_id, auth.id, "clip.move", json!({ "clipId": clip.id, "version": clip.version }), input.client_seq).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "clip-updated",
        &json!({ "clip": clip, "serverSeq": seq }),
    ).await;

    Ok(Json(clip))
}

pub async fn delete_clip(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "UPDATE clips SET deleted_at = now(), updated_at = now(), version = version + 1
         WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(clip_id)
    .execute(&mut *tx)
    .await?;
    let seq = insert_operation(&mut tx, project_id, auth.id, "clip.delete", json!({ "clipId": clip_id }), None).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "clip-deleted",
        &json!({ "clipId": clip_id, "serverSeq": seq }),
    ).await;

    Ok(Json(json!({ "deleted": true })))
}

pub async fn split_clip(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<SplitClip>,
) -> AppResult<Json<Vec<Clip>>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;
    let mut tx = state.pool.begin().await?;
    let original = sqlx::query_as::<_, Clip>(
        "SELECT id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version
         FROM clips WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(project_id)
    .bind(clip_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Clip not found".to_string()))?;

    if input.at_time_ms <= original.track_position_ms
        || input.at_time_ms >= original.track_position_ms + original.duration_ms
    {
        return Err(AppError::Validation("Split point must be inside clip bounds".to_string()));
    }

    let left_duration = input.at_time_ms - original.track_position_ms;
    let right_duration = original.duration_ms - left_duration;
    let left_out = original.in_point_ms + left_duration;

    let left = sqlx::query_as::<_, Clip>(
        "UPDATE clips SET out_point_ms = $3, duration_ms = $4, version = version + 1, updated_at = now()
         WHERE id = $1 AND project_id = $2
         RETURNING id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version",
    )
    .bind(clip_id)
    .bind(project_id)
    .bind(left_out)
    .bind(left_duration)
    .fetch_one(&mut *tx)
    .await?;

    let right = sqlx::query_as::<_, Clip>(
        "INSERT INTO clips (project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, project_id, track_id, asset_id, name, track_position_ms, in_point_ms, out_point_ms, duration_ms, transform, version",
    )
    .bind(project_id)
    .bind(original.track_id)
    .bind(original.asset_id)
    .bind(format!("{} Split", original.name))
    .bind(input.at_time_ms)
    .bind(left_out)
    .bind(original.out_point_ms)
    .bind(right_duration)
    .bind(original.transform)
    .fetch_one(&mut *tx)
    .await?;

    insert_operation(&mut tx, project_id, auth.id, "clip.split", json!({ "leftClipId": left.id, "rightClipId": right.id, "atTimeMs": input.at_time_ms }), input.client_seq).await?;
    tx.commit().await?;
    Ok(Json(vec![left, right]))
}

pub async fn batch_clips(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(ops): Json<Vec<BatchClipOp>>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;
    let mut tx = state.pool.begin().await?;
    for op in &ops {
        sqlx::query(
            "UPDATE clips SET
                track_position_ms = COALESCE($3, track_position_ms),
                track_id = COALESCE($4, track_id),
                version = version + 1, updated_at = now()
             WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL",
        )
        .bind(project_id)
        .bind(op.clip_id)
        .bind(op.track_position_ms)
        .bind(op.track_id)
        .execute(&mut *tx)
        .await?;
    }
    insert_operation(&mut tx, project_id, auth.id, "clip.batch", json!({ "count": ops.len() }), None).await?;
    tx.commit().await?;
    Ok(Json(json!({ "updated": ops.len() })))
}

// ─── Track Handlers ───────────────────────────────────────────────────────────

pub async fn create_track(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(input): Json<CreateTrack>,
) -> AppResult<Json<Track>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    if !matches!(input.track_type.as_str(), "video" | "audio") {
        return Err(AppError::Validation("type must be video or audio".to_string()));
    }

    let max_index: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(order_index), 0) FROM tracks WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&state.pool)
    .await?;

    let track = sqlx::query_as::<_, Track>(
        "INSERT INTO tracks (project_id, type, label, order_index, color)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, project_id, type AS track_type, label, order_index, is_locked, is_muted, color",
    )
    .bind(project_id)
    .bind(&input.track_type)
    .bind(&input.label)
    .bind(input.order_index.unwrap_or(max_index + 1))
    .bind(input.color.as_deref().unwrap_or("#2563eb"))
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(track))
}

pub async fn update_track(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, track_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateTrack>,
) -> AppResult<Json<Track>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let track = sqlx::query_as::<_, Track>(
        "UPDATE tracks SET
            label = COALESCE($3, label),
            order_index = COALESCE($4, order_index),
            is_locked = COALESCE($5, is_locked),
            is_muted = COALESCE($6, is_muted),
            color = COALESCE($7, color),
            updated_at = now()
         WHERE project_id = $1 AND id = $2
         RETURNING id, project_id, type AS track_type, label, order_index, is_locked, is_muted, color",
    )
    .bind(project_id)
    .bind(track_id)
    .bind(input.label)
    .bind(input.order_index)
    .bind(input.is_locked)
    .bind(input.is_muted)
    .bind(input.color)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Track not found".to_string()))?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "track-updated",
        &json!({ "track": track }),
    ).await;

    Ok(Json(track))
}

pub async fn delete_track(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, track_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    sqlx::query(
        "UPDATE clips SET deleted_at = now(), updated_at = now() WHERE track_id = $1 AND project_id = $2",
    )
    .bind(track_id)
    .bind(project_id)
    .execute(&state.pool)
    .await?;

    sqlx::query("DELETE FROM tracks WHERE project_id = $1 AND id = $2")
        .bind(project_id)
        .bind(track_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({ "deleted": true })))
}

// ─── Effect Handlers ──────────────────────────────────────────────────────────

pub async fn create_effect(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<CreateEffect>,
) -> AppResult<Json<ClipEffect>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    if !matches!(input.effect_type.as_str(), "brightness" | "contrast" | "saturation" | "blur") {
        return Err(AppError::Validation("Invalid effect type".to_string()));
    }

    let max_order: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(order_index), 0) FROM clip_effects WHERE clip_id = $1",
    )
    .bind(clip_id)
    .fetch_one(&state.pool)
    .await?;

    let mut tx = state.pool.begin().await?;
    let effect = sqlx::query_as::<_, ClipEffect>(
        "INSERT INTO clip_effects (clip_id, type, order_index, params, enabled)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, clip_id, type AS effect_type, order_index, params, enabled",
    )
    .bind(clip_id)
    .bind(&input.effect_type)
    .bind(max_order + 1)
    .bind(input.params.unwrap_or(json!({ "value": 0 })))
    .bind(input.enabled.unwrap_or(true))
    .fetch_one(&mut *tx)
    .await?;

    insert_operation(&mut tx, project_id, auth.id, "effect.add", json!({ "clipId": clip_id, "effectId": effect.id }), None).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "effect-updated",
        &json!({ "clipId": clip_id, "effect": effect }),
    ).await;

    Ok(Json(effect))
}

pub async fn update_effect(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id, effect_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(input): Json<UpdateEffect>,
) -> AppResult<Json<ClipEffect>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let mut tx = state.pool.begin().await?;
    let effect = sqlx::query_as::<_, ClipEffect>(
        "UPDATE clip_effects SET
            params = COALESCE($3, params),
            enabled = COALESCE($4, enabled),
            updated_at = now()
         WHERE clip_id = $1 AND id = $2
         RETURNING id, clip_id, type AS effect_type, order_index, params, enabled",
    )
    .bind(clip_id)
    .bind(effect_id)
    .bind(input.params)
    .bind(input.enabled)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Effect not found".to_string()))?;

    insert_operation(&mut tx, project_id, auth.id, "effect.update", json!({ "clipId": clip_id, "effectId": effect.id }), None).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "effect-updated",
        &json!({ "clipId": clip_id, "effect": effect }),
    ).await;

    Ok(Json(effect))
}

pub async fn delete_effect(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id, effect_id)): Path<(Uuid, Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM clip_effects WHERE clip_id = $1 AND id = $2")
        .bind(clip_id)
        .bind(effect_id)
        .execute(&mut *tx)
        .await?;

    insert_operation(&mut tx, project_id, auth.id, "effect.delete", json!({ "clipId": clip_id, "effectId": effect_id }), None).await?;
    tx.commit().await?;

    Ok(Json(json!({ "deleted": true })))
}

pub async fn reorder_effects(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, clip_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<ReorderEffects>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let mut tx = state.pool.begin().await?;
    for (index, effect_id) in input.effect_ids.iter().enumerate() {
        sqlx::query("UPDATE clip_effects SET order_index = $3, updated_at = now() WHERE clip_id = $1 AND id = $2")
            .bind(clip_id)
            .bind(effect_id)
            .bind(index as i32)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "reordered": true })))
}

// ─── Transition Handlers ──────────────────────────────────────────────────────

pub async fn create_transition(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(input): Json<CreateTransition>,
) -> AppResult<Json<Transition>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    if !matches!(input.transition_type.as_str(), "dissolve" | "wipe_left" | "wipe_right" | "fade") {
        return Err(AppError::Validation("Invalid transition type".to_string()));
    }

    let mut tx = state.pool.begin().await?;
    let transition = sqlx::query_as::<_, Transition>(
        "INSERT INTO transitions (project_id, from_clip_id, to_clip_id, type, duration_ms, params)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, project_id, from_clip_id, to_clip_id, type AS transition_type, duration_ms, params",
    )
    .bind(project_id)
    .bind(input.from_clip_id)
    .bind(input.to_clip_id)
    .bind(&input.transition_type)
    .bind(input.duration_ms)
    .bind(input.params.unwrap_or(json!({})))
    .fetch_one(&mut *tx)
    .await?;

    insert_operation(&mut tx, project_id, auth.id, "transition.add", json!({ "transitionId": transition.id }), None).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "transition-updated",
        &json!({ "transition": transition }),
    ).await;

    Ok(Json(transition))
}

pub async fn update_transition(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, transition_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateTransition>,
) -> AppResult<Json<Transition>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let transition = sqlx::query_as::<_, Transition>(
        "UPDATE transitions SET
            type = COALESCE($3, type),
            duration_ms = COALESCE($4, duration_ms),
            params = COALESCE($5, params),
            updated_at = now()
         WHERE project_id = $1 AND id = $2
         RETURNING id, project_id, from_clip_id, to_clip_id, type AS transition_type, duration_ms, params",
    )
    .bind(project_id)
    .bind(transition_id)
    .bind(input.transition_type)
    .bind(input.duration_ms)
    .bind(input.params)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Transition not found".to_string()))?;

    Ok(Json(transition))
}

pub async fn delete_transition(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, transition_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    sqlx::query("DELETE FROM transitions WHERE project_id = $1 AND id = $2")
        .bind(project_id)
        .bind(transition_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({ "deleted": true })))
}

// ─── TextOverlay Handlers ─────────────────────────────────────────────────────

pub async fn create_text_overlay(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
    Json(input): Json<CreateTextOverlay>,
) -> AppResult<Json<TextOverlay>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let mut tx = state.pool.begin().await?;
    let overlay = sqlx::query_as::<_, TextOverlay>(
        "INSERT INTO text_overlays (project_id, track_position_ms, duration_ms, content,
            font_family, font_size, font_color, position, alignment, animation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, project_id, track_position_ms, duration_ms, content,
            font_family, font_size, font_color, position, alignment, animation",
    )
    .bind(project_id)
    .bind(input.track_position_ms)
    .bind(input.duration_ms)
    .bind(&input.content)
    .bind(input.font_family.as_deref().unwrap_or("sans-serif"))
    .bind(input.font_size.unwrap_or(48))
    .bind(input.font_color.as_deref().unwrap_or("#ffffff"))
    .bind(input.position.unwrap_or(json!({ "x": 50, "y": 80 })))
    .bind(input.alignment.as_deref().unwrap_or("center"))
    .bind(input.animation.as_deref().unwrap_or("none"))
    .fetch_one(&mut *tx)
    .await?;

    insert_operation(&mut tx, project_id, auth.id, "text.add", json!({ "overlayId": overlay.id }), None).await?;
    tx.commit().await?;

    let _ = pusher::broadcast(
        &format!("private-project-{project_id}"),
        "text-overlay-updated",
        &json!({ "overlay": overlay }),
    ).await;

    Ok(Json(overlay))
}

pub async fn update_text_overlay(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, overlay_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateTextOverlay>,
) -> AppResult<Json<TextOverlay>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    let overlay = sqlx::query_as::<_, TextOverlay>(
        "UPDATE text_overlays SET
            track_position_ms = COALESCE($3, track_position_ms),
            duration_ms = COALESCE($4, duration_ms),
            content = COALESCE($5, content),
            font_family = COALESCE($6, font_family),
            font_size = COALESCE($7, font_size),
            font_color = COALESCE($8, font_color),
            position = COALESCE($9, position),
            alignment = COALESCE($10, alignment),
            animation = COALESCE($11, animation),
            updated_at = now()
         WHERE project_id = $1 AND id = $2
         RETURNING id, project_id, track_position_ms, duration_ms, content,
            font_family, font_size, font_color, position, alignment, animation",
    )
    .bind(project_id)
    .bind(overlay_id)
    .bind(input.track_position_ms)
    .bind(input.duration_ms)
    .bind(input.content)
    .bind(input.font_family)
    .bind(input.font_size)
    .bind(input.font_color)
    .bind(input.position)
    .bind(input.alignment)
    .bind(input.animation)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Text overlay not found".to_string()))?;

    Ok(Json(overlay))
}

pub async fn delete_text_overlay(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((project_id, overlay_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let role = workspace_role_for_project(&state.pool, project_id, auth.id).await?;
    require_editor(&role)?;

    sqlx::query("DELETE FROM text_overlays WHERE project_id = $1 AND id = $2")
        .bind(project_id)
        .bind(overlay_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({ "deleted": true })))
}
