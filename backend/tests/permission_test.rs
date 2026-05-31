use backend::db::queries::require_editor;

#[test]
fn editor_roles_can_mutate_timeline() {
    assert!(require_editor("owner").is_ok());
    assert!(require_editor("admin").is_ok());
    assert!(require_editor("editor").is_ok());
    assert!(require_editor("viewer").is_err());
}
