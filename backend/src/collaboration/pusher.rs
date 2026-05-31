use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub async fn broadcast<T: Serialize>(channel: &str, event: &str, payload: &T) -> anyhow::Result<()> {
    let app_id = std::env::var("PUSHER_APP_ID").unwrap_or_default();
    let key = std::env::var("PUSHER_KEY").unwrap_or_default();
    let secret = std::env::var("PUSHER_SECRET").unwrap_or_default();
    let cluster = std::env::var("PUSHER_CLUSTER").unwrap_or_default();

    if app_id.is_empty() || secret.is_empty() {
        tracing::debug!(channel, event, "Pusher not configured, skipping broadcast");
        return Ok(());
    }

    let data_string = serde_json::to_string(payload)?;
    let body = serde_json::json!({
        "name": event,
        "channel": channel,
        "data": data_string,
    });
    let body_bytes = serde_json::to_vec(&body)?;
    let body_md5 = hex_encode(&md5::compute(&body_bytes).0);

    let timestamp = chrono::Utc::now().timestamp();
    let auth_params = format!(
        "auth_key={key}&auth_timestamp={timestamp}&auth_version=1.0&body_md5={body_md5}"
    );
    let path = format!("/apps/{app_id}/events");
    let to_sign = format!("POST\n{path}\n{auth_params}");

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| anyhow::anyhow!("HMAC key error: {e}"))?;
    mac.update(to_sign.as_bytes());
    let signature = hex_encode(&mac.finalize().into_bytes());

    let url = format!(
        "https://api-{cluster}.pusher.com{path}?{auth_params}&auth_signature={signature}"
    );

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body_bytes)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::warn!(channel, event, %status, error = text, "Pusher broadcast failed");
    }

    Ok(())
}
