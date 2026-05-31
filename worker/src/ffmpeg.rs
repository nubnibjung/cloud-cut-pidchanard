use std::{path::Path, process::Stdio};

use tokio::process::Command;

use crate::error::{WorkerError, WorkerResult};

pub async fn ffprobe_json(input: &str) -> WorkerResult<serde_json::Value> {
    let output = Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input])
        .stdout(Stdio::piped())
        .output()
        .await
        .map_err(|err| WorkerError::Ffmpeg(err.to_string()))?;
    if !output.status.success() {
        return Err(WorkerError::Ffmpeg(String::from_utf8_lossy(&output.stderr).to_string()));
    }
    serde_json::from_slice(&output.stdout).map_err(|err| WorkerError::Ffmpeg(err.to_string()))
}

pub async fn generate_proxy(input: &str, output: &Path) -> WorkerResult<()> {
    run_ffmpeg(vec!["-i".into(), input.into(), "-vf".into(), "scale=-2:720".into(), "-c:v".into(), "libx264".into(), "-preset".into(), "fast".into(), "-crf".into(), "28".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(), output.to_string_lossy().to_string()]).await
}

pub async fn trim_segment(input: &str, start: &str, end: &str, output: &Path) -> WorkerResult<()> {
    run_ffmpeg(vec!["-i".into(), input.into(), "-ss".into(), start.into(), "-to".into(), end.into(), "-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into(), output.to_string_lossy().to_string()]).await
}

pub async fn concat_segments(list_file: &Path, output: &Path) -> WorkerResult<()> {
    run_ffmpeg(vec!["-f".into(), "concat".into(), "-safe".into(), "0".into(), "-i".into(), list_file.to_string_lossy().to_string(), "-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into(), output.to_string_lossy().to_string()]).await
}

pub async fn apply_vf_filter(input: &Path, vf: &str, output: &Path) -> WorkerResult<()> {
    run_ffmpeg(vec![
        "-i".into(),
        input.to_string_lossy().to_string(),
        "-vf".into(),
        vf.to_string(),
        "-c:v".into(), "libx264".into(),
        "-c:a".into(), "copy".into(),
        output.to_string_lossy().to_string(),
    ])
    .await
}

async fn run_ffmpeg(args: Vec<String>) -> WorkerResult<()> {
    let output = Command::new("ffmpeg")
        .args(["-y"])
        .args(args)
        .output()
        .await
        .map_err(|err| WorkerError::Ffmpeg(err.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WorkerError::Ffmpeg(String::from_utf8_lossy(&output.stderr).to_string()))
    }
}
