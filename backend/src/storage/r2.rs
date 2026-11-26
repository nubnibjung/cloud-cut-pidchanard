//! Cloudflare R2 (S3-compatible) object storage.
//!
//! Only presigned URLs are needed: the browser uploads straight to R2 with a presigned
//! PUT, and the worker reads media and writes exports through presigned GET/HEAD/PUT.
//! Signing is AWS Signature V4 in query-string form, which R2 accepts with region "auto".

use std::fmt;
use std::path::Path;
use std::time::Duration;

use chrono::Utc;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct R2 {
    account_id: String,
    bucket: String,
    access_key_id: String,
    secret_access_key: String,
    /// Public address of the bucket (r2.dev subdomain or a custom domain), no trailing slash.
    public_base_url: String,
}

// Never print the secret in logs
impl fmt::Debug for R2 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("R2")
            .field("account_id", &self.account_id)
            .field("bucket", &self.bucket)
            .field("public_base_url", &self.public_base_url)
            .finish_non_exhaustive()
    }
}

impl R2 {
    /// Reads R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and
    /// R2_PUBLIC_URL. Returns None (local disk storage) unless all five are set.
    pub fn from_env() -> Option<Self> {
        let var = |name: &str| std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Some(Self {
            account_id: var("R2_ACCOUNT_ID")?,
            bucket: var("R2_BUCKET")?,
            access_key_id: var("R2_ACCESS_KEY_ID")?,
            secret_access_key: var("R2_SECRET_ACCESS_KEY")?,
            public_base_url: var("R2_PUBLIC_URL")?.trim_end_matches('/').to_string(),
        })
    }

    pub fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.public_base_url, encode_path(key.trim_start_matches('/')))
    }

    /// The object key behind one of this bucket's public URLs, or None for any other URL.
    pub fn key_from_public_url(&self, url: &str) -> Option<String> {
        let rest = url.strip_prefix(&self.public_base_url)?.strip_prefix('/')?;
        let rest = rest.split(['?', '#']).next()?;
        (!rest.is_empty() && !rest.contains("..")).then(|| percent_decode(rest))
    }

    fn host(&self) -> String {
        format!("{}.r2.cloudflarestorage.com", self.account_id)
    }

    /// A URL that allows `method` (GET, PUT, HEAD, DELETE) on `key` for `expires`.
    pub fn presign(&self, method: &str, key: &str, expires: Duration) -> String {
        let now = Utc::now();
        let uri = format!("/{}/{}", encode_path(&self.bucket), encode_path(key.trim_start_matches('/')));
        sign_url(
            &SigningKey { access_key_id: &self.access_key_id, secret: &self.secret_access_key, region: "auto" },
            method,
            &self.host(),
            &uri,
            &now.format("%Y%m%dT%H%M%SZ").to_string(),
            expires.as_secs().clamp(1, 604_800),
        )
    }

    /// Whether the object exists: Ok(false) only for a definite 404; any other
    /// failure (bad keys, network) is an Err describing it.
    pub async fn exists(&self, key: &str) -> Result<bool, String> {
        let url = self.presign("HEAD", key, Duration::from_secs(60));
        match reqwest::Client::new().head(url).send().await {
            Ok(r) if r.status().is_success() => Ok(true),
            Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => Ok(false),
            Ok(r) => Err(format!("R2 answered {}", r.status())),
            Err(e) => Err(format!("R2 unreachable: {e}")),
        }
    }

    pub fn bucket(&self) -> &str {
        &self.bucket
    }

    /// Uploads a local file, streaming it rather than reading it into memory.
    pub async fn put_file(&self, path: &Path, key: &str, content_type: &str) -> anyhow::Result<()> {
        let file = tokio::fs::File::open(path).await?;
        let len = file.metadata().await?.len();
        let url = self.presign("PUT", key, Duration::from_secs(3600));
        let response = reqwest::Client::new()
            .put(url)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .header(reqwest::header::CONTENT_LENGTH, len)
            .body(reqwest::Body::from(file))
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("R2 upload failed ({status}): {}", body.chars().take(300).collect::<String>());
        }
        Ok(())
    }
}

struct SigningKey<'a> {
    access_key_id: &'a str,
    secret: &'a str,
    region: &'a str,
}

/// AWS SigV4 query-string signing (S3 service, UNSIGNED-PAYLOAD, only `host` signed).
fn sign_url(key: &SigningKey, method: &str, host: &str, uri: &str, amz_date: &str, expires_secs: u64) -> String {
    let date = &amz_date[..8];
    let scope = format!("{date}/{}/s3/aws4_request", key.region);
    // Already in sorted order
    let query = format!(
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}&X-Amz-Date={amz_date}&X-Amz-Expires={expires_secs}&X-Amz-SignedHeaders=host",
        encode(&format!("{}/{scope}", key.access_key_id)),
    );
    let canonical_request = format!("{method}
{uri}
{query}
host:{host}

host
UNSIGNED-PAYLOAD");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256
{amz_date}
{scope}
{}",
        hex(&Sha256::digest(canonical_request.as_bytes())),
    );
    let mut k = hmac(format!("AWS4{}", key.secret).as_bytes(), date.as_bytes());
    for part in [key.region, "s3", "aws4_request"] {
        k = hmac(&k, part.as_bytes());
    }
    let signature = hex(&hmac(&k, string_to_sign.as_bytes()));
    format!("https://{host}{uri}?{query}&X-Amz-Signature={signature}")
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// RFC 3986 encoding as SigV4 expects: everything but A-Z a-z 0-9 - _ . ~ is escaped.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Like `encode`, but keeps the slashes between path segments.
fn encode_path(s: &str) -> String {
    s.split('/').map(encode).collect::<Vec<_>>().join("/")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r2() -> R2 {
        R2 {
            account_id: "acct".into(),
            bucket: "media".into(),
            access_key_id: "AKID".into(),
            secret_access_key: "secret".into(),
            public_base_url: "https://pub-x.r2.dev".into(),
        }
    }

    #[test]
    fn public_url_round_trips_to_key() {
        let r2 = r2();
        let url = r2.public_url("uploads/p1/a b.mp4");
        assert_eq!(url, "https://pub-x.r2.dev/uploads/p1/a%20b.mp4");
        assert_eq!(r2.key_from_public_url(&url).as_deref(), Some("uploads/p1/a b.mp4"));
        assert_eq!(r2.key_from_public_url("https://evil.example/uploads/x"), None);
        assert_eq!(r2.key_from_public_url("https://pub-x.r2.dev/../x"), None);
    }

    #[test]
    fn presigned_url_has_expected_shape() {
        let url = r2().presign("PUT", "uploads/p1/x.mp4", Duration::from_secs(900));
        assert!(url.starts_with("https://acct.r2.cloudflarestorage.com/media/uploads/p1/x.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(url.contains("X-Amz-Expires=900"));
        assert!(url.contains("X-Amz-Credential=AKID%2F"));
        let sig = url.rsplit("X-Amz-Signature=").next().unwrap();
        assert_eq!(sig.len(), 64);
    }

    #[test]
    fn presigned_url_matches_aws_example() {
        // "Example: presigned URL" from the Amazon S3 SigV4 query-string auth documentation
        let key = SigningKey {
            access_key_id: "AKIAIOSFODNN7EXAMPLE",
            secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region: "us-east-1",
        };
        let url = sign_url(&key, "GET", "examplebucket.s3.amazonaws.com", "/test.txt", "20130524T000000Z", 86400);
        assert!(url.ends_with("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"), "{url}");
    }

    #[test]
    fn signing_key_matches_aws_reference() {
        // Example from the AWS SigV4 documentation (deriving the signing key)
        let mut k = hmac(b"AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", b"20120215");
        for part in ["us-east-1", "iam", "aws4_request"] {
            k = hmac(&k, part.as_bytes());
        }
        assert_eq!(hex(&k), "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
    }
}
