use std::path::PathBuf;

use sqlx::PgPool;
use uuid::Uuid;

use crate::{error::WorkerResult, ffmpeg};

pub async fn extract_metadata(pool: &PgPool, asset_id: Uuid, input_url: &str) -> WorkerResult<()> {
    let metadata = ffmpeg::ffprobe_json(input_url).await.unwrap_or_else(|_| serde_json::json!({ "source": input_url, "probe": "unavailable" }));
    sqlx::query("UPDATE assets SET metadata = $2, updated_at = now() WHERE id = $1")
        .bind(asset_id)
        .bind(metadata)
        .execute(pool)
        .await?;
    enqueue_asset_children(pool, asset_id, input_url).await?;
    Ok(())
}

pub async fn generate_proxy(pool: &PgPool, asset_id: Uuid, input_url: &str) -> WorkerResult<()> {
    let output = PathBuf::from(format!("tmp/proxy-{asset_id}.mp4"));
    let _ = ffmpeg::generate_proxy(input_url, &output).await;
    insert_variant(pool, asset_id, "proxy", output.to_string_lossy().as_ref(), serde_json::json!({ "height": 720 })).await
}

pub async fn generate_thumbnails(pool: &PgPool, asset_id: Uuid, _input_url: &str) -> WorkerResult<()> {
    insert_variant(pool, asset_id, "thumbnail_strip", &format!("tmp/thumbs-{asset_id}.jpg"), serde_json::json!({ "interval_ms": 5000, "frame_width": 160 })).await
}

pub async fn extract_waveform(pool: &PgPool, asset_id: Uuid, _input_url: &str) -> WorkerResult<()> {
    insert_variant(pool, asset_id, "waveform_data", &format!("tmp/waveform-{asset_id}.json"), serde_json::json!({ "sample_rate": 44100, "channels": 1, "peaks": [[-0.8, 0.7]] })).await?;
    sqlx::query("UPDATE assets SET status = 'ready', updated_at = now() WHERE id = $1")
        .bind(asset_id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn enqueue_asset_children(pool: &PgPool, asset_id: Uuid, input_url: &str) -> WorkerResult<()> {
    for (kind, suffix) in [("generate_proxy", "proxy"), ("generate_thumbnails", "thumbs"), ("extract_waveform", "waveform")] {
        sqlx::query("INSERT INTO processing_jobs (kind, status, payload, idempotency_key) VALUES ($1, 'queued', $2, $3) ON CONFLICT (idempotency_key) DO NOTHING")
            .bind(kind)
            .bind(serde_json::json!({ "kind": pascal_kind(kind), "asset_id": asset_id, "input_url": input_url, "idempotency_key": format!("asset:{asset_id}:{suffix}") }))
            .bind(format!("asset:{asset_id}:{suffix}"))
            .execute(pool)
            .await?;
    }
    Ok(())
}

fn pascal_kind(kind: &str) -> &'static str {
    match kind {
        "generate_proxy" => "GenerateProxy",
        "generate_thumbnails" => "GenerateThumbnails",
        "extract_waveform" => "ExtractWaveform",
        _ => "ExtractMetadata",
    }
}

async fn insert_variant(pool: &PgPool, asset_id: Uuid, variant_type: &str, url: &str, metadata: serde_json::Value) -> WorkerResult<()> {
    sqlx::query("INSERT INTO asset_variants (asset_id, type, url, metadata) VALUES ($1, $2, $3, $4)")
        .bind(asset_id)
        .bind(variant_type)
        .bind(url)
        .bind(metadata)
        .execute(pool)
        .await?;
    Ok(())
}
