-- Per-user workspace pins: pinned workspaces sort to the top of that person's list.
CREATE TABLE workspace_pins (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX workspace_pins_workspace_id_idx ON workspace_pins (workspace_id);
