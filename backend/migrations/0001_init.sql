CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    avatar_url text,
    oauth_provider text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL,
    plan text NOT NULL CHECK (plan IN ('free', 'pro', 'team')),
    owner_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE workspace_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'expired')),
    token text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    settings jsonb NOT NULL DEFAULT '{"resolution":"1080p","fps":30,"aspect_ratio":"16:9"}',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_by uuid NOT NULL REFERENCES users(id),
    type text NOT NULL CHECK (type IN ('video', 'audio', 'image')),
    original_url text NOT NULL,
    status text NOT NULL CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE asset_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('proxy', 'thumbnail_strip', 'waveform_data')),
    url text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tracks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('video', 'audio')),
    label text NOT NULL,
    order_index integer NOT NULL,
    is_locked boolean NOT NULL DEFAULT false,
    is_muted boolean NOT NULL DEFAULT false,
    color text NOT NULL DEFAULT '#64748b',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL REFERENCES assets(id),
    name text NOT NULL,
    track_position_ms integer NOT NULL CHECK (track_position_ms >= 0),
    in_point_ms integer NOT NULL CHECK (in_point_ms >= 0),
    out_point_ms integer NOT NULL CHECK (out_point_ms > in_point_ms),
    duration_ms integer NOT NULL CHECK (duration_ms > 0),
    transform jsonb NOT NULL DEFAULT '{"x":0,"y":0,"scale":1,"rotation":0,"opacity":1}',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE clip_effects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('brightness', 'contrast', 'saturation', 'blur')),
    order_index integer NOT NULL,
    params jsonb NOT NULL DEFAULT '{}',
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    to_clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('dissolve', 'wipe_left', 'wipe_right', 'fade')),
    duration_ms integer NOT NULL CHECK (duration_ms > 0),
    params jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE text_overlays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    track_position_ms integer NOT NULL,
    duration_ms integer NOT NULL,
    content text NOT NULL,
    font_family text NOT NULL DEFAULT 'Inter',
    font_size integer NOT NULL DEFAULT 32,
    font_color text NOT NULL DEFAULT '#ffffff',
    position jsonb NOT NULL DEFAULT '{"x":0.5,"y":0.5}',
    alignment text NOT NULL DEFAULT 'center',
    background_color text,
    background_opacity numeric NOT NULL DEFAULT 0,
    animation text NOT NULL CHECK (animation IN ('fade_in', 'typewriter', 'none')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE export_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES users(id),
    format text NOT NULL CHECK (format IN ('mp4', 'webm')),
    resolution text NOT NULL CHECK (resolution IN ('720p', '1080p', '4k')),
    quality text NOT NULL CHECK (quality IN ('draft', 'standard', 'high')),
    status text NOT NULL CHECK (status IN ('queued', 'processing', 'uploading', 'completed', 'failed', 'cancelled')),
    progress_percent integer NOT NULL DEFAULT 0,
    output_url text,
    output_file_size bigint,
    started_at timestamptz,
    completed_at timestamptz,
    expires_at timestamptz,
    error_message text,
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('extract_metadata', 'generate_proxy', 'generate_thumbnails', 'extract_waveform', 'render_export', 'cleanup')),
    status text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
    payload jsonb NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 4,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    error_message text,
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operation_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id),
    operation_type text NOT NULL,
    payload jsonb NOT NULL,
    client_seq bigint,
    server_seq bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE operation_server_seq;
