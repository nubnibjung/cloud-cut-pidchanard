use sqlx::{PgPool, Row};
use serde::Deserialize;
use std::{path::PathBuf, process::Stdio};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    time::{sleep, timeout, Duration},
};
use uuid::Uuid;
use tracing::{error, info, warn};

use crate::config::Config;

pub async fn run(pool: PgPool, config: Config) {
    // On startup, reset any jobs stuck in processing from a previous crash
    reset_stuck_jobs(&pool).await;

    info!("Job worker started");
    loop {
        if let Err(e) = process_next_job(&pool, &config).await {
            error!("Worker error: {e:#}");
        }
        sleep(Duration::from_millis(500)).await;
    }
}

async fn reset_stuck_jobs(pool: &PgPool) {
    // processing_jobs: reset to queued so they're retried
    match sqlx::query(
        "UPDATE processing_jobs
         SET status = 'queued', next_run_at = now(), updated_at = now()
         WHERE status = 'processing' AND attempts < max_attempts",
    )
    .execute(pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 =>
            info!("Reset {} stuck processing job(s) to queued", r.rows_affected()),
        _ => {}
    }

    // export_jobs: mark as failed so the frontend can show an error and let the user retry
    match sqlx::query(
        "UPDATE export_jobs
         SET status = 'failed',
             error_message = 'Render interrupted — server restarted. Click Export to try again.',
             updated_at = now()
         WHERE status = 'processing'",
    )
    .execute(pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 =>
            info!("Marked {} stuck export job(s) as failed", r.rows_affected()),
        _ => {}
    }

    // Discard queued render_export jobs whose paired export_job is already failed/cancelled.
    // This prevents a stale bad-payload job from being picked up before the user's fresh retry.
    match sqlx::query(
        "UPDATE processing_jobs pj
         SET status = 'dead_letter', updated_at = now()
         FROM export_jobs ej
         WHERE pj.kind = 'render_export'
           AND pj.status = 'queued'
           AND (pj.payload->>'export_id')::uuid = ej.id
           AND ej.status IN ('failed', 'cancelled')",
    )
    .execute(pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 =>
            info!("Discarded {} orphaned render_export job(s)", r.rows_affected()),
        _ => {}
    }
}

/// Extract the local file path from a public URL.
/// URL: http://host/uploads/UUID.ext  →  uploads/UUID.ext
fn url_to_path(url: &str) -> Option<PathBuf> {
    let key = url.split("/uploads/").nth(1)?;
    if key.is_empty() { return None; }
    Some(PathBuf::from("uploads").join(key))
}

fn ffprobe_path() -> String {
    std::env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".to_string())
}

async fn process_next_job(pool: &PgPool, config: &Config) -> anyhow::Result<()> {
    let row = sqlx::query(
        "UPDATE processing_jobs
         SET status = 'processing', attempts = attempts + 1, updated_at = now()
         WHERE id = (
             SELECT id FROM processing_jobs
             WHERE kind IN ('extract_metadata', 'render_export')
               AND status = 'queued'
               AND next_run_at <= now()
               AND attempts < max_attempts
             ORDER BY created_at
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, kind, payload",
    )
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(()); };

    let job_id: Uuid  = row.try_get("id")?;
    let kind: String  = row.try_get("kind")?;
    let payload: serde_json::Value = row.try_get("payload")?;

    let result = match kind.as_str() {
        "extract_metadata" => job_extract_metadata(pool, &payload).await,
        "render_export"    => job_render_export(pool, config, &payload).await,
        other => { warn!("Unknown job kind: {other}"); Ok(()) }
    };

    match result {
        Ok(()) => {
            sqlx::query(
                "UPDATE processing_jobs SET status = 'completed', updated_at = now() WHERE id = $1",
            )
            .bind(job_id)
            .execute(pool)
            .await?;
        }
        Err(e) => {
            let msg = format!("{e:#}");
            error!("Job {job_id} ({kind}) failed: {msg}");
            sqlx::query(
                "UPDATE processing_jobs SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1",
            )
            .bind(job_id)
            .bind(&msg)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

// ── extract_metadata ──────────────────────────────────────────────────────────

async fn job_extract_metadata(pool: &PgPool, payload: &serde_json::Value) -> anyhow::Result<()> {
    let asset_id: Uuid = payload["asset_id"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow::anyhow!("missing asset_id"))?;

    let input_url = payload["input_url"].as_str().unwrap_or_default();
    let duration_ms = probe_duration_ms(input_url).await.unwrap_or(0);

    let metadata = if duration_ms > 0 {
        serde_json::json!({ "duration_ms": duration_ms })
    } else {
        serde_json::json!({})
    };

    sqlx::query(
        "UPDATE assets SET status = 'ready', metadata = $2, updated_at = now() WHERE id = $1",
    )
    .bind(asset_id)
    .bind(&metadata)
    .execute(pool)
    .await?;

    info!("Asset {asset_id} ready (duration_ms={duration_ms})");
    Ok(())
}

async fn probe_duration_ms(url: &str) -> Option<i64> {
    let path = url_to_path(url)?;
    let out = tokio::process::Command::new(ffprobe_path())
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.to_str()?])
        .output().await.ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout);
        let secs: f64 = s.trim().parse().ok()?;
        Some((secs * 1000.0) as i64)
    } else {
        None
    }
}

// ── render_export ─────────────────────────────────────────────────────────────

async fn job_render_export(
    pool: &PgPool,
    config: &Config,
    payload: &serde_json::Value,
) -> anyhow::Result<()> {
    let export_id: Uuid = payload["export_id"]
        .as_str().and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow::anyhow!("missing export_id"))?;
    let project_id: Uuid = payload["project_id"]
        .as_str().and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow::anyhow!("missing project_id"))?;

    info!("Rendering export {export_id} for project {project_id}");

    sqlx::query(
        "UPDATE export_jobs SET status = 'processing', started_at = now(), progress_percent = 0, updated_at = now() WHERE id = $1",
    )
    .bind(export_id).execute(pool).await?;

    let timeline_clips: Vec<ExportClipSnapshot> = serde_json::from_value(
        payload
            .get("timeline_clips")
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("missing timeline snapshot"))?,
    )?;
    if timeline_clips.is_empty() {
        anyhow::bail!("timeline snapshot is empty");
    }

    match render_timeline(pool, config, export_id, project_id, timeline_clips).await {
        Ok(output_url) => {
            sqlx::query(
                "UPDATE export_jobs SET status = 'completed', progress_percent = 100, output_url = $2, completed_at = now(), updated_at = now() WHERE id = $1",
            )
            .bind(export_id).bind(&output_url).execute(pool).await?;
            info!("Export {export_id} completed → {output_url}");
        }
        Err(e) => {
            let msg = format!("{e:#}");
            error!("Export {export_id} failed: {msg}");
            sqlx::query(
                "UPDATE export_jobs SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1",
            )
            .bind(export_id).bind(&msg).execute(pool).await?;
            return Err(e);
        }
    }
    Ok(())
}

struct ClipEntry {
    track_position_ms: i32,
    in_point_ms: i32,
    out_point_ms: i32,
    original_url: String,
    asset_type: String,
}

#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd)]
struct LayerSortKey {
    type_rank: i32,
    label_number: i32,
    order_index: i32,
}

#[derive(Deserialize)]
struct ExportClipSnapshot {
    track_id: Uuid,
    asset_id: Uuid,
    track_position_ms: i32,
    in_point_ms: i32,
    out_point_ms: i32,
}

struct ReadyClip<'a> {
    entry: &'a ClipEntry,
    path: String,
    has_audio: bool,
}

async fn load_export_clips(
    pool: &PgPool,
    project_id: Uuid,
    timeline_clips: Vec<ExportClipSnapshot>,
) -> anyhow::Result<Vec<ClipEntry>> {
    let mut clips = Vec::with_capacity(timeline_clips.len());
    for clip in timeline_clips {
        let row = sqlx::query(
            "SELECT a.original_url, a.type as asset_type,
                    t.type as track_type, t.label as track_label, t.order_index
             FROM assets a
             JOIN tracks t ON t.id = $3 AND t.project_id = $1
             WHERE a.id = $2 AND a.project_id = $1 AND a.deleted_at IS NULL",
        )
        .bind(project_id)
        .bind(clip.asset_id)
        .bind(clip.track_id)
        .fetch_optional(pool)
        .await?;

        if let Some(row) = row {
            let track_type: String = row.try_get("track_type")?;
            let track_label: String = row.try_get("track_label")?;
            clips.push((
                LayerSortKey {
                    type_rank: if track_type == "video" { 0 } else { 1 },
                    label_number: track_label_number(&track_label),
                    order_index: row.try_get("order_index")?,
                },
                ClipEntry {
                    track_position_ms: clip.track_position_ms,
                    in_point_ms: clip.in_point_ms,
                    out_point_ms: clip.out_point_ms,
                    original_url: row.try_get("original_url")?,
                    asset_type: row.try_get("asset_type")?,
                },
            ));
        }
    }

    if clips.is_empty() { anyhow::bail!("No clips in project"); }

    clips.sort_by(|a, b| {
        b.0.type_rank.cmp(&a.0.type_rank)
            .then_with(|| b.0.label_number.cmp(&a.0.label_number))
            .then_with(|| b.0.order_index.cmp(&a.0.order_index))
            .then_with(|| a.1.track_position_ms.cmp(&b.1.track_position_ms))
    });
    Ok(clips.into_iter().map(|(_, clip)| clip).collect())
}

fn track_label_number(label: &str) -> i32 {
    label
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

async fn render_timeline(
    pool: &PgPool,
    config: &Config,
    export_id: Uuid,
    project_id: Uuid,
    timeline_clips: Vec<ExportClipSnapshot>,
) -> anyhow::Result<String> {
    let clips = load_export_clips(pool, project_id, timeline_clips).await?;

    let total_ms = clips.iter()
        .map(|c| c.track_position_ms + (c.out_point_ms - c.in_point_ms))
        .max().unwrap_or(0);
    if total_ms == 0 { anyhow::bail!("Timeline has zero duration"); }

    let ffmpeg = config.ffmpeg_path.as_str();
    if tokio::process::Command::new(ffmpeg).arg("-version").output().await.is_err() {
        anyhow::bail!("FFmpeg is required to export the edited timeline. Set FFMPEG_PATH or install FFmpeg. Tried: {ffmpeg}");
    }

    // Pre-validate: resolve file paths and skip missing files
    let mut ready: Vec<ReadyClip> = Vec::new();
    for clip in &clips {
        match url_to_path(&clip.original_url) {
            Some(p) if p.exists() => {
                let path = p.display().to_string();
                ready.push(ReadyClip {
                    entry: clip,
                    has_audio: clip.asset_type == "audio" || media_has_audio(config, &path).await,
                    path,
                });
            }
            Some(p) => warn!("Skipping clip — file not found: {}", p.display()),
            None    => warn!("Skipping clip — bad URL: {}", clip.original_url),
        }
    }
    if ready.is_empty() {
        anyhow::bail!("No accessible media files found for this project. Make sure assets are uploaded.");
    }
    info!("{}/{} clips have accessible files", ready.len(), clips.len());

    // Recalculate total duration based on clips we can actually render
    let total_ms = ready.iter()
        .map(|c| c.entry.track_position_ms + (c.entry.out_point_ms - c.entry.in_point_ms))
        .max().unwrap_or(0);
    if total_ms == 0 { anyhow::bail!("Timeline has zero duration"); }
    let total_sec = total_ms as f64 / 1000.0;

    // Build FFmpeg args
    let mut args: Vec<String> = vec![
        "-f".into(), "lavfi".into(),
        "-t".into(), format!("{total_sec:.3}"),
        "-i".into(), "color=black:s=1920x1080:r=30".into(),
    ];

    for rc in &ready {
        let clip = rc.entry;
        let dur_sec = (clip.out_point_ms - clip.in_point_ms) as f64 / 1000.0;
        let in_sec  = clip.in_point_ms as f64 / 1000.0;
        if clip.asset_type == "image" {
            args.extend(["-loop".into(),"1".into(),"-t".into(),format!("{dur_sec:.3}"),"-i".into(),rc.path.clone()]);
        } else {
            args.extend(["-ss".into(),format!("{in_sec:.3}"),"-t".into(),format!("{dur_sec:.3}"),"-i".into(),rc.path.clone()]);
        }
    }

    let mut filters: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    let mut video_map = "[0:v]".to_string();
    for (i, rc) in ready.iter().enumerate() {
        let clip = rc.entry;
        let idx = i + 1;
        if clip.asset_type == "audio" {
            continue;
        }

        let dur_ms  = clip.out_point_ms - clip.in_point_ms;
        let dur_sec = dur_ms as f64 / 1000.0;
        let pos_sec = clip.track_position_ms as f64 / 1000.0;
        let end_sec = pos_sec + dur_ms as f64 / 1000.0;
        filters.push(format!(
            "color=c=black@0.0:s=1920x1080:r=30:d={dur_sec:.3},format=rgba[blank{idx}]"
        ));
        filters.push(format!(
            "[{idx}:v]scale=1920:1080:force_original_aspect_ratio=decrease,\
             format=rgba[scaled{idx}]"
        ));
        filters.push(format!(
            "[blank{idx}][scaled{idx}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1,\
             setpts=PTS-STARTPTS+{pos_sec:.3}/TB[cv{idx}]"
        ));
        let next = format!("[comp{idx}]");
        filters.push(format!("{video_map}[cv{idx}]overlay=0:0:eof_action=pass:shortest=0:enable='between(t,{pos_sec:.3},{end_sec:.3})'{next}"));
        video_map = next;
    }

    for (i, rc) in ready.iter().enumerate() {
        let clip = rc.entry;
        let idx = i + 1;
        if rc.has_audio {
            let d = clip.track_position_ms;
            filters.push(format!("[{idx}:a]adelay={d}|{d}[aud{idx}]"));
            audio_labels.push(format!("[aud{idx}]"));
        }
    }

    let audio_map: Option<String> = if !audio_labels.is_empty() {
        let n = audio_labels.len();
        let inputs = audio_labels.join("");
        filters.push(format!("{inputs}amix=inputs={n}:duration=longest[aout]"));
        Some("[aout]".into())
    } else { None };

    let out_key  = format!("export_{export_id}.mp4");
    let out_path = PathBuf::from("uploads").join(&out_key);

    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.extend(["-map".into(), video_map]);
    if let Some(ref am) = audio_map { args.extend(["-map".into(), am.clone()]); }
    args.extend([
        "-c:v".into(),"libx264".into(),"-preset".into(),"ultrafast".into(),"-crf".into(),"23".into(),
        "-pix_fmt".into(),"yuv420p".into(),
        "-c:a".into(),"aac".into(),
        "-movflags".into(),"+faststart".into(),
        "-t".into(), format!("{total_sec:.3}"),
        "-progress".into(), "pipe:1".into(),
        "-nostats".into(),
        "-y".into(), out_path.display().to_string(),
    ]);

    info!("ffmpeg {}", args.join(" "));

    // 30-minute hard timeout on the entire render
    let render = timeout(Duration::from_secs(30 * 60), run_ffmpeg(pool, export_id, ffmpeg, args, total_ms)).await;
    match render {
        Ok(r) => r?,
        Err(_) => anyhow::bail!("FFmpeg render timed out after 30 minutes"),
    }

    let base_url = config.storage_public_base_url.trim_end_matches("/uploads");
    Ok(format!("{base_url}/uploads/{out_key}"))
}

async fn media_has_audio(config: &Config, path: &str) -> bool {
    let Ok(out) = tokio::process::Command::new(&config.ffprobe_path)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            path,
        ])
        .output()
        .await
    else {
        return false;
    };

    out.status.success() && !String::from_utf8_lossy(&out.stdout).trim().is_empty()
}

/// Spawn FFmpeg, stream progress updates to DB, wait for exit.
async fn run_ffmpeg(
    pool: &PgPool,
    export_id: Uuid,
    ffmpeg: &str,
    args: Vec<String>,
    total_ms: i32,
) -> anyhow::Result<()> {
    let mut child = tokio::process::Command::new(ffmpeg)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("stdout not captured"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow::anyhow!("stderr not captured"))?;
    let total_us = total_ms as i64 * 1000;

    // Drain stderr in background to prevent pipe deadlock
    let stderr_task = tokio::spawn(async move {
        let mut s = String::new();
        BufReader::new(stderr).read_to_string(&mut s).await.ok();
        s
    });

    // Read -progress pipe:1 output and update export_jobs.progress_percent
    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await? {
        if let Some(val) = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="))
        {
            if let Ok(us) = val.trim().parse::<i64>() {
                if us > 0 && total_us > 0 {
                    let pct = ((us as f64 / total_us as f64) * 100.0) as i32;
                    let _ = sqlx::query(
                        "UPDATE export_jobs SET progress_percent = $2, updated_at = now() WHERE id = $1",
                    )
                    .bind(export_id).bind(pct.clamp(1, 99))
                    .execute(pool).await;
                }
            }
        }
    }

    let status = child.wait().await?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let last = &stderr_text[stderr_text.len().saturating_sub(1500)..];
        anyhow::bail!("FFmpeg failed (exit {:?}):\n{}", status.code(), last);
    }
    Ok(())
}
