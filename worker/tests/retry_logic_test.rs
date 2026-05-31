use worker::queue::backoff_seconds;

#[test]
fn retry_backoff_matches_required_schedule() {
    assert_eq!(backoff_seconds(1), 1);
    assert_eq!(backoff_seconds(2), 4);
    assert_eq!(backoff_seconds(3), 16);
}
