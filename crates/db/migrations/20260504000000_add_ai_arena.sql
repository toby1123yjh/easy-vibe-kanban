-- AI Arena: parallel multi-agent attempts on a single issue.
--
-- Adds:
--   * arena_groups table — keyed on local_issues; one group represents
--     one "race" where N workspaces (each with a different executor)
--     try the same prompt in parallel.
--   * workspaces.arena_group_id (nullable) — links a workspace to its
--     arena group; NULL for legacy single-attempt workspaces.
--   * workspaces.arena_status — 'active' | 'promoted' | 'archived',
--     orthogonal to the existing workspaces.archived flag (which
--     remains "user-driven soft archive").
--
-- See docs/future/ai-arena/spec.md §3 for rationale.

PRAGMA foreign_keys = ON;

CREATE TABLE arena_groups (
    id                    BLOB PRIMARY KEY,
    issue_id              BLOB NOT NULL,
    project_id            BLOB NOT NULL,
    prompt                TEXT NOT NULL,
    base_branch           TEXT NOT NULL,
    promoted_workspace_id BLOB,
    promoted_at           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (issue_id)              REFERENCES local_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id)            REFERENCES projects(id)     ON DELETE CASCADE,
    FOREIGN KEY (promoted_workspace_id) REFERENCES workspaces(id)   ON DELETE SET NULL
);

CREATE INDEX idx_arena_groups_issue_id   ON arena_groups(issue_id);
CREATE INDEX idx_arena_groups_project_id ON arena_groups(project_id);

-- Partial index: at most one un-promoted (active) group per issue is
-- expected at any time; this index speeds the "active group for issue"
-- lookup that powers the kanban-card → arena-tab redirect.
CREATE INDEX idx_arena_groups_active_per_issue
    ON arena_groups(issue_id)
    WHERE promoted_workspace_id IS NULL;

ALTER TABLE workspaces ADD COLUMN arena_group_id BLOB
    REFERENCES arena_groups(id) ON DELETE SET NULL;

ALTER TABLE workspaces ADD COLUMN arena_status TEXT
    NOT NULL DEFAULT 'active'
    CHECK (arena_status IN ('active','promoted','archived'));

CREATE INDEX idx_workspaces_arena_group_id ON workspaces(arena_group_id);

-- Verify FK consistency before committing.
PRAGMA foreign_key_check;
