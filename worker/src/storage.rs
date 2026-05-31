/// Convert a local file path to a public HTTP URL.
/// Worker saves exports to `uploads/exports/` so the Axum ServeDir at /uploads serves them.
pub fn export_http_url(export_id: uuid::Uuid) -> String {
    let base = std::env::var("PUBLIC_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8080".to_string());
    format!("{}/uploads/exports/{}.mp4", base.trim_end_matches('/'), export_id)
}

pub fn export_output_path(export_id: uuid::Uuid) -> std::path::PathBuf {
    let dir = std::path::PathBuf::from(
        std::env::var("WORKER_OUTPUT_DIR").unwrap_or_else(|_| "./uploads/exports".to_string()),
    );
    std::fs::create_dir_all(&dir).ok();
    dir.join(format!("{export_id}.mp4"))
}
