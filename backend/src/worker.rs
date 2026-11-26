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
    // Poll quickly while there is work, and back off while the queue is empty so an
    // idle server isn't sending the database two queries a second around the clock.
    let mut idle_delay = POLL_MIN;
    loop {
        match process_next_job(&pool, &config).await {
            Ok(true) => idle_delay = POLL_MIN,
            Ok(false) => idle_delay = (idle_delay * 2).min(POLL_MAX),
            Err(e) => {
                error!("Worker error: {e:#}");
                idle_delay = POLL_MAX;
            }
        }
        sleep(idle_delay).await;
    }
}

const POLL_MIN: Duration = Duration::from_millis(500);
/// Upper bound on how long a newly queued job (e.g. an export) can wait to be picked up.
const POLL_MAX: Duration = Duration::from_secs(2);

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

/// Where ffmpeg should read an asset from: a local file, or a short-lived signed R2
/// link. None when the file is missing or the URL isn't in this app's own storage.
async fn media_input(config: &Config, url: &str) -> Option<String> {
    if let Some(path) = crate::storage::local_upload_path(config, url) {
        return path.exists().then(|| path.display().to_string());
    }
    let r2 = config.r2.as_ref()?;
    let key = r2.key_from_public_url(url)?;
    if !r2.exists(&key).await {
        return None;
    }
    // Long enough for a 30-minute render plus seeking
    Some(r2.presign("GET", &key, Duration::from_secs(2 * 60 * 60)))
}

fn ffprobe_path() -> String {
    std::env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".to_string())
}

/// Claims and runs the oldest runnable job. Returns whether there was one.
async fn process_next_job(pool: &PgPool, config: &Config) -> anyhow::Result<bool> {
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

    let Some(row) = row else { return Ok(false); };

    let job_id: Uuid  = row.try_get("id")?;
    let kind: String  = row.try_get("kind")?;
    let payload: serde_json::Value = row.try_get("payload")?;

    let result = match kind.as_str() {
        "extract_metadata" => job_extract_metadata(pool, config, &payload).await,
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

    Ok(true)
}

// ── extract_metadata ──────────────────────────────────────────────────────────

async fn job_extract_metadata(pool: &PgPool, config: &Config, payload: &serde_json::Value) -> anyhow::Result<()> {
    let asset_id: Uuid = payload["asset_id"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| anyhow::anyhow!("missing asset_id"))?;

    let input_url = payload["input_url"].as_str().unwrap_or_default();
    let duration_ms = probe_duration_ms(config, input_url).await.unwrap_or(0);

    let metadata = if duration_ms > 0 {
        serde_json::json!({ "duration_ms": duration_ms })
    } else {
        serde_json::json!({})
    };

    sqlx::query(
        // Merge, so fields set at upload time (e.g. original_name) are kept
        "UPDATE assets SET status = 'ready', metadata = COALESCE(metadata, '{}'::jsonb) || $2, updated_at = now() WHERE id = $1",
    )
    .bind(asset_id)
    .bind(&metadata)
    .execute(pool)
    .await?;

    info!("Asset {asset_id} ready (duration_ms={duration_ms})");
    Ok(())
}

async fn probe_duration_ms(config: &Config, url: &str) -> Option<i64> {
    let input = media_input(config, url).await?;
    let out = tokio::process::Command::new(ffprobe_path())
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", &input])
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
    transform: ClipTransform,
}

#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd)]
struct LayerSortKey {
    type_rank: i32,
    label_number: i32,
    order_index: i32,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(default)]
struct ClipTransform {
    x: f64,
    y: f64,
    scale: f64,
    rotation: f64,
    opacity: f64,
}

impl Default for ClipTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            rotation: 0.0,
            opacity: 1.0,
        }
    }
}

#[derive(Deserialize)]
struct ExportClipSnapshot {
    track_id: Uuid,
    asset_id: Uuid,
    track_position_ms: i32,
    in_point_ms: i32,
    out_point_ms: i32,
    #[serde(default)]
    transform: ClipTransform,
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
                    transform: clip.transform,
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
        match media_input(config, &clip.original_url).await {
            Some(path) => {
                ready.push(ReadyClip {
                    entry: clip,
                    has_audio: clip.asset_type == "audio" || media_has_audio(config, &path).await,
                    path,
                });
            }
            None => warn!("Skipping clip — file missing or not in our storage: {}", clip.original_url),
        }
    }
    if ready.is_empty() {
        // Usually the server's disk was wiped (on Render's free plan that happens on every
        // deploy or restart) while the database still lists the uploads.
        anyhow::bail!("The media files for this project are no longer on the server. Upload the clips again, then export.");
    }
    info!("{}/{} clips have accessible files", ready.len(), clips.len());

    // Recalculate total duration based on clips we can actually render
    let total_ms = ready.iter()
        .map(|c| c.entry.track_position_ms + (c.entry.out_point_ms - c.entry.in_point_ms))
        .max().unwrap_or(0);
    if total_ms == 0 { anyhow::bail!("Timeline has zero duration"); }
    let total_sec = total_ms as f64 / 1000.0;

    // Output size. Clip transforms are stored in 1920x1080 preview coordinates and are
    // scaled to the output. EXPORT_HEIGHT (e.g. 720) lowers memory use on small servers.
    let out_h: i32 = std::env::var("EXPORT_HEIGHT").ok()
        .and_then(|v| v.parse().ok())
        .filter(|h: &i32| (240..=2160).contains(h))
        .unwrap_or(1080) / 2 * 2;
    let out_w: i32 = (out_h * 16 / 9) / 2 * 2;
    let k = out_h as f64 / 1080.0;

    // Build FFmpeg args
    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(),
        // One decoding/filtering thread each: slower, but a fraction of the memory
        "-threads".into(), "1".into(),
        "-filter_complex_threads".into(), "1".into(),
        "-f".into(), "lavfi".into(),
        "-t".into(), format!("{total_sec:.3}"),
        "-i".into(), format!("color=black:s={out_w}x{out_h}:r=30"),
    ];

    for rc in &ready {
        let clip = rc.entry;
        let dur_sec = (clip.out_point_ms - clip.in_point_ms) as f64 / 1000.0;
        let in_sec  = clip.in_point_ms as f64 / 1000.0;
        if clip.asset_type == "image" {
            args.extend(["-loop".into(),"1".into(),"-framerate".into(),"30".into(),"-t".into(),format!("{dur_sec:.3}"),"-i".into(),rc.path.clone()]);
        } else {
            args.extend(["-ss".into(),format!("{in_sec:.3}"),"-t".into(),format!("{dur_sec:.3}"),"-i".into(),rc.path.clone()]);
        }
    }

    let mut filters: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    // Each clip is scaled, shifted to its timeline position and overlaid straight onto
    // the running composite. (No full-frame transparent canvas per clip: that cost a
    // 1920x1080 RGBA frame per clip per frame and ran small servers out of memory.)
    let mut video_map = "[0:v]".to_string();
    for (i, rc) in ready.iter().enumerate() {
        let clip = rc.entry;
        let idx = i + 1;
        if clip.asset_type == "audio" {
            continue;
        }

        let dur_ms  = clip.out_point_ms - clip.in_point_ms;
        let pos_sec = clip.track_position_ms as f64 / 1000.0;
        let end_sec = pos_sec + dur_ms as f64 / 1000.0;
        let transform = clip.transform;
        let scale = transform.scale.max(0.01);
        let opacity = transform.opacity.clamp(0.0, 1.0);
        let rotated = transform.rotation.abs() > 0.01;
        let faded = opacity < 0.999;

        let mut chain = format!(
            "[{idx}:v]scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,             scale=trunc(iw*{scale:.6}/2)*2:trunc(ih*{scale:.6}/2)*2"
        );
        // Only pay for an alpha channel when the clip needs one
        if rotated || faded {
            chain.push_str(",format=rgba");
        }
        if rotated {
            // Grow the frame to fit the turned clip, as the preview does, instead of clipping its corners
            let a = format!("{:.6}*PI/180", transform.rotation);
            chain.push_str(&format!(",rotate={a}:c=none:ow=rotw({a}):oh=roth({a})"));
        }
        if faded {
            chain.push_str(&format!(",colorchannelmixer=aa={opacity:.6}"));
        }
        chain.push_str(&format!(",setpts=PTS-STARTPTS+{pos_sec:.3}/TB[s{idx}]"));
        filters.push(chain);

        let next = format!("[comp{idx}]");
        filters.push(format!(
            "{video_map}[s{idx}]overlay=x=(W-w)/2+{x:.3}:y=(H-h)/2+{y:.3}:eof_action=pass:enable='between(t,{pos_sec:.3},{end_sec:.3})'{next}",
            x = transform.x * k,
            y = transform.y * k,
        ));
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
    // With R2 the file is only staged locally, then uploaded and removed
    let out_dir = if config.r2.is_some() { "tmp" } else { "uploads" };
    std::fs::create_dir_all(out_dir).ok();
    let out_path = PathBuf::from(out_dir).join(&out_key);

    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.extend(["-map".into(), video_map]);
    if let Some(ref am) = audio_map { args.extend(["-map".into(), am.clone()]); }
    args.extend([
        "-c:v".into(),"libx264".into(),"-preset".into(),"ultrafast".into(),"-crf".into(),"23".into(),
        "-pix_fmt".into(),"yuv420p".into(),
        "-threads".into(),"2".into(),
        "-c:a".into(),"aac".into(),
        "-movflags".into(),"+faststart".into(),
        "-t".into(), format!("{total_sec:.3}"),
        "-progress".into(), "pipe:1".into(),
        "-nostats".into(),
        "-y".into(), out_path.display().to_string(),
    ]);

    // Signed R2 links are credentials: keep them out of logs and error messages
    let redact = |text: &str| {
        ready.iter().fold(text.to_string(), |acc, rc| match rc.path.split_once('?') {
            Some((bare, _)) => acc.replace(&rc.path, bare),
            None => acc,
        })
    };
    info!("ffmpeg {}", redact(&args.join(" ")));

    // 30-minute hard timeout on the entire render
    let render = timeout(Duration::from_secs(30 * 60), run_ffmpeg(pool, export_id, ffmpeg, args, total_ms)).await;
    match render {
        Ok(r) => r.map_err(|e| anyhow::anyhow!(redact(&format!("{e:#}"))))?,
        Err(_) => anyhow::bail!("FFmpeg render timed out after 30 minutes"),
    }

    if let Some(r2) = &config.r2 {
        let key = format!("exports/{out_key}");
        let uploaded = r2.put_file(&out_path, &key, "video/mp4").await;
        let _ = std::fs::remove_file(&out_path);
        uploaded?;
        return Ok(r2.public_url(&key));
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
        let tail: String = stderr_text.chars().rev().take(1500).collect::<Vec<_>>().into_iter().rev().collect();
        let last = tail.as_str();
        anyhow::bail!("FFmpeg failed (exit {:?}):\n{}", status.code(), last);
    }
    Ok(())
}
