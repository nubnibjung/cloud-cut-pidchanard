pub mod handlers;
pub mod r2;

use crate::config::Config;

pub fn public_upload_url(config: &Config, object_key: &str) -> String {
    format!("{}/{}", config.storage_public_base_url.trim_end_matches('/'), object_key.trim_start_matches('/'))
}

/// Local path of a file uploaded to this server's disk, from its public URL.
/// http://host/uploads/UUID.ext → uploads/UUID.ext
pub fn local_upload_path(config: &Config, url: &str) -> Option<std::path::PathBuf> {
    let base = format!("{}/", config.storage_public_base_url.trim_end_matches('/'));
    let key = url.strip_prefix(&base)?;
    if key.is_empty() || key.contains("..") || key.contains('\\') { return None; }
    Some(std::path::PathBuf::from("uploads").join(key))
}

/// Whether `url` is a file in this app's own storage (R2 bucket or local uploads).
pub fn is_own_media_url(config: &Config, url: &str) -> bool {
    config.r2.as_ref().is_some_and(|r2| r2.key_from_public_url(url).is_some())
        || local_upload_path(config, url).is_some()
}
