CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;
-- Prevents duplicate active user accounts and supports login lookup.

CREATE UNIQUE INDEX workspaces_slug_unique ON workspaces (slug) WHERE deleted_at IS NULL;
-- Supports stable workspace URLs and fast slug lookup.

CREATE UNIQUE INDEX workspace_members_workspace_user_unique ON workspace_members (workspace_id, user_id);
-- Prevents duplicate memberships for authorization checks.

CREATE INDEX idx_projects_workspace_updated ON projects (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
-- Used for cursor pagination of projects inside a workspace.

CREATE INDEX idx_assets_project_status ON assets (project_id, status) WHERE deleted_at IS NULL;
-- Used by asset browser filters and processing status updates.

CREATE INDEX idx_tracks_project_order ON tracks (project_id, order_index);
-- Loads timeline tracks in deterministic editor order.

CREATE INDEX idx_clips_project_track_position ON clips (project_id, track_id, track_position_ms) WHERE deleted_at IS NULL;
-- Used for timeline range reads and export ordering.

CREATE INDEX idx_clip_effects_clip_order ON clip_effects (clip_id, order_index);
-- Preserves effect stack order per clip.

CREATE INDEX idx_operation_logs_project_created ON operation_logs (project_id, created_at);
-- Supports audit and time-based archive jobs.

CREATE INDEX idx_operation_logs_project_server_seq ON operation_logs (project_id, server_seq);
-- Supports reconnect sync after last_seen_server_seq.

CREATE INDEX idx_export_jobs_project_created ON export_jobs (project_id, created_at DESC);
-- Lists export history per project.

CREATE UNIQUE INDEX export_jobs_idempotency_unique ON export_jobs (idempotency_key);
-- Prevents duplicate export requests from retries.

CREATE UNIQUE INDEX processing_jobs_idempotency_unique ON processing_jobs (idempotency_key);
-- Prevents duplicate worker execution records.

CREATE INDEX idx_processing_jobs_poll ON processing_jobs (status, next_run_at, created_at);
-- Lets workers claim due queued or failed jobs efficiently.
