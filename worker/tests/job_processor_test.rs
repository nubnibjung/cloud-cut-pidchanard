use serde_json::json;
use worker::processor::JobPayload;

#[test]
fn processor_payload_deserializes_tagged_job() {
    let payload: JobPayload = serde_json::from_value(json!({
        "kind": "CleanupExpiredFiles",
        "run_id": "018f0000-0000-7000-8000-000000000099"
    })).unwrap();
    assert!(matches!(payload, JobPayload::CleanupExpiredFiles { .. }));
}
