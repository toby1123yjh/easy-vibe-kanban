ALTER TABLE workspaces
    ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'worktree'
    CHECK (workspace_kind IN ('worktree', 'direct_folder'));

ALTER TABLE workspaces
    ADD COLUMN container_ownership TEXT NOT NULL DEFAULT 'managed'
    CHECK (container_ownership IN ('managed', 'external'));

CREATE INDEX idx_workspaces_container_ownership
    ON workspaces(container_ownership);
