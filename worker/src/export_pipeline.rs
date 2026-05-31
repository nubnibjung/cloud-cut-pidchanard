use std::{fs, path::PathBuf};

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{error::WorkerResult, ffmpeg, progress, storage};

#[derive(Debug, FromRow)]
struct ExportClip {
    original_url: String,
    #[allow(dead_code)]
    track_position_ms: i32,
    in_point_ms: i32,
    out_point_ms: i32,
    effects: serde_json::Value,
}

fn ms_to_timecode(ms: i32) -> String {
    let total_s = ms / 1000;
    let h = total_s / 3600;
    let m = (total_s % 3600) / 60;
    let s = total_s % 60;
    format!("{h:02}:{m:02}:{s:02}.{:03}", ms % 1000)
}

pub async fn render_export(pool: &PgPool, export_id: Uuid, project_id: Uuid) -> WorkerResult<()> {
    progress::update(pool, export_id, 5, "processing").await?;

    let clips = sqlx::query_as::<_, ExportClip>(
        "SELECT a.original_url, c.track_position_ms, c.in_point_ms, c.out_point_ms,
                COALESCE(
                    (SELECT json_agg(json_build_object('type', ce.type, 'params', ce.params, 'enabled', ce.enabled)
                             ORDER BY ce.order_index)
                     FROM clip_effects ce WHERE ce.clip_id = c.id AND ce.enabled = true),
                    '[]'::json
                ) AS effects
         FROM clips c
         JOIN tracks t ON t.id = c.track_id AND t.type = 'video'
         JOIN assets a ON a.id = c.asset_id
         WHERE c.project_id = $1 AND c.deleted_at IS NULL
         ORDER BY t.order_index, c.track_position_ms",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let output = storage::export_output_path(export_id);
    let output_url = storage::export_http_url(export_id);

    if clips.is_empty() {
        // Write empty placeholder so the download link doesn't 404
        fs::write(&output, b"empty project").ok();
        sqlx::query(
            "UPDATE export_jobs SET status = 'completed', progress_percent = 100,
             output_url = $2, completed_at = now(), updated_at = now() WHERE id = $1",
        )
        .bind(export_id)
        .bind(&output_url)
        .execute(pool)
        .await?;
        return Ok(());
    }

    let work_dir = output.parent().unwrap().join(export_id.to_string());
    fs::create_dir_all(&work_dir).ok();
    progress::update(pool, export_id, 20, "processing").await?;

    let total = clips.len();
    let mut segment_paths: Vec<PathBuf> = Vec::new();

    for (idx, clip) in clips.iter().enumerate() {
        let segment = work_dir.join(format!("seg_{idx:03}.mp4"));
        let start = ms_to_timecode(clip.in_point_ms);
        let end   = ms_to_timecode(clip.out_point_ms);

        // resolve relative URL to local path if needed
        let input_path = resolve_input(&clip.original_url);

        if ffmpeg::trim_segment(&input_path, &start, &end, &segment).await.is_err() {
            tracing::warn!(url = %clip.original_url, "ffmpeg trim failed — skipping seg {idx}");
            continue;
        }

        // apply effects
        let vf = build_vf_filter(clip.effects.as_array().unwrap_or(&vec![]));
        if !vf.is_empty() {
            let fx = work_dir.join(format!("seg_{idx:03}_fx.mp4"));
            if ffmpeg::apply_vf_filter(&segment, &vf, &fx).await.is_ok() {
                segment_paths.push(fx);
            } else {
                segment_paths.push(segment);
            }
        } else {
            segment_paths.push(segment);
        }

        let pct = 20 + ((idx + 1) * 50 / total) as i32;
        progress::update(pool, export_id, pct, "processing").await?;
    }

    progress::update(pool, export_id, 75, "processing").await?;

    if segment_paths.len() == 1 {
        fs::rename(&segment_paths[0], &output).ok();
    } else if !segment_paths.is_empty() {
        let list_path = work_dir.join("segments.txt");
        let content = segment_paths
            .iter()
            .map(|p| format!("file '{}'", p.display()))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&list_path, content).ok();
        ffmpeg::concat_segments(&list_path, &output).await?;
    } else {
        return Err(crate::error::WorkerError::Ffmpeg("All segments failed".into()));
    }

    fs::remove_dir_all(&work_dir).ok();
    progress::update(pool, export_id, 95, "uploading").await?;

    let file_size = fs::metadata(&output).map(|m| m.len() as i64).unwrap_or(0);
    sqlx::query(
        "UPDATE export_jobs SET status = 'completed', progress_percent = 100,
         output_url = $2, output_file_size = $3, completed_at = now(), updated_at = now()
         WHERE id = $1",
    )
    .bind(export_id)
    .bind(&output_url)
    .bind(file_size)
    .execute(pool)
    .await?;

    tracing::info!(export_id = %export_id, %output_url, bytes = file_size, "Export completed");
    Ok(())
}

/// If the URL is an HTTP URL, return it as-is.
/// If it's a relative path like `uploads/foo.mp4`, make it absolute.
fn resolve_input(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        // strip leading slash
        url.trim_start_matches('/').to_string()
    }
}

fn build_vf_filter(effects: &[serde_json::Value]) -> String {
    let mut brightness = 0.0_f64;
    let mut contrast   = 1.0_f64;
    let mut saturation = 1.0_f64;
    let mut blur       = 0.0_f64;

    for e in effects {
        let kind  = e.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let value = e.get("params").and_then(|p| p.get("value")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        match kind {
            "brightness" => brightness = value / 100.0,
            "contrast"   => contrast   = 1.0 + value / 100.0,
            "saturation" => saturation = 1.0 + value / 100.0,
            "blur" if value > 0.0 => blur = value,
            _ => {}
        }
    }

    let mut parts = Vec::new();
    if brightness != 0.0 || contrast != 1.0 || saturation != 1.0 {
        parts.push(format!("eq=brightness={brightness:.3}:contrast={contrast:.3}:saturation={saturation:.3}"));
    }
    if blur > 0.0 {
        parts.push(format!("gblur=sigma={:.2}", (blur / 10.0).max(0.1)));
    }
    parts.join(",")
}
