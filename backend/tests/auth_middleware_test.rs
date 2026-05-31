use backend::auth::password::{hash_password, verify_password};

#[test]
fn password_hash_verifies_original_password() {
    let hash = hash_password("correct horse battery staple").unwrap();
    assert!(verify_password("correct horse battery staple", &hash));
    assert!(!verify_password("wrong password", &hash));
}
