-- Per-user project pins: each person chooses their own pinned projects.
CREATE TABLE project_pins (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);

CREATE INDEX project_pins_project_id_idx ON project_pins (project_id);
