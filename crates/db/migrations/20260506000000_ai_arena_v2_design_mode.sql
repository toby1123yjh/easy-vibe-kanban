-- AI Arena v2: split product mode and lifecycle from workspace status.
--
-- v1 used "promoted_workspace_id IS NULL" as a proxy for active. That
-- makes a closed-but-not-promoted arena block future arena creation. v2
-- keeps workspace-backed attempts, but tracks product lifecycle explicitly.

PRAGMA foreign_keys = ON;

ALTER TABLE arena_groups ADD COLUMN mode TEXT
    NOT NULL DEFAULT 'implementation'
    CHECK (mode IN ('design','implementation'));

ALTER TABLE arena_groups ADD COLUMN lifecycle_status TEXT
    NOT NULL DEFAULT 'open'
    CHECK (lifecycle_status IN ('open','closed','adopted','implementation_started'));

ALTER TABLE arena_groups ADD COLUMN closed_at TEXT;

ALTER TABLE arena_groups ADD COLUMN implementation_workspace_id BLOB
    REFERENCES workspaces(id) ON DELETE SET NULL;

UPDATE arena_groups
   SET lifecycle_status = CASE
       WHEN promoted_workspace_id IS NULL THEN 'open'
       ELSE 'adopted'
   END,
       implementation_workspace_id = promoted_workspace_id;

CREATE INDEX idx_arena_groups_issue_lifecycle
    ON arena_groups(issue_id, lifecycle_status);

CREATE INDEX idx_arena_groups_mode
    ON arena_groups(mode);

PRAGMA foreign_key_check;
