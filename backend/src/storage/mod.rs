pub mod handlers;

use crate::config::Config;

pub fn public_upload_url(config: &Config, object_key: &str) -> String {
    format!("{}/{}", config.storage_public_base_url.trim_end_matches('/'), object_key.trim_start_matches('/'))
}
