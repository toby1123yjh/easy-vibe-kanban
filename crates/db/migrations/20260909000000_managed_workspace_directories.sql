-- Explicit, narrow ownership for auto-created direct directories. Existing
-- external directories and managed Git worktrees never gain this ownership.
CREATE TABLE managed_workspace_directories (
    workspace_id BLOB PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    root_path TEXT NOT NULL,
    directory_path TEXT NOT NULL UNIQUE,
    ownership_token TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'removed')),
    quarantine_path TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Stale clients must not start a new session after explicit directory removal.
CREATE TRIGGER managed_directory_session_insert_guard
BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM managed_workspace_directories
             WHERE workspace_id = NEW.workspace_id AND state != 'active')
BEGIN
    SELECT RAISE(ABORT, 'Managed session directory was removed');
END;

CREATE TRIGGER managed_directory_session_update_guard
BEFORE UPDATE OF workspace_id ON sessions
WHEN EXISTS (SELECT 1 FROM managed_workspace_directories
             WHERE workspace_id = NEW.workspace_id AND state != 'active')
BEGIN
    SELECT RAISE(ABORT, 'Managed session directory was removed');
END;
