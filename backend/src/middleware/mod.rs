pub mod rate_limit {
    pub fn workspace_upload_key(workspace_id: uuid::Uuid) -> String {
        format!("rate:workspace:{workspace_id}:uploads")
    }
}
