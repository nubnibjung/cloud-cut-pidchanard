#[test]
fn deterministic_asset_job_key_prevents_duplicates() {
    let asset_id = "018f0000-0000-7000-8000-000000000030";
    assert_eq!(format!("asset:{asset_id}:metadata"), "asset:018f0000-0000-7000-8000-000000000030:metadata");
}
