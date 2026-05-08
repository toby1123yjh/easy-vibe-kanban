-- AI Arena page-level activity.
--
-- Records actions that are not owned by a single attempt conversation:
-- Ask all, Challenge, Synthesize, and Start implementation. This lets
-- the Arena page explain what happened across panes and lets synthesis
-- runs include prior page-level prompts without inheriting one attempt's
-- session history.

PRAGMA foreign_keys = ON;

CREATE TABLE arena_events (
    id                     BLOB PRIMARY KEY,
    arena_group_id         BLOB NOT NULL,
    kind                   TEXT NOT NULL
                           CHECK (kind IN ('ask_all','workspace','challenge','synthesize','start_implementation')),
    prompt                 TEXT NOT NULL,
    source_workspace_id    BLOB,
    target_workspace_id    BLOB,
    synthesis_workspace_id BLOB,
    created_at             TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (arena_group_id)         REFERENCES arena_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (source_workspace_id)    REFERENCES workspaces(id)    ON DELETE SET NULL,
    FOREIGN KEY (target_workspace_id)    REFERENCES workspaces(id)    ON DELETE SET NULL,
    FOREIGN KEY (synthesis_workspace_id) REFERENCES workspaces(id)    ON DELETE SET NULL
);

CREATE INDEX idx_arena_events_group_created
    ON arena_events(arena_group_id, created_at);

CREATE INDEX idx_arena_events_kind
    ON arena_events(kind);

PRAGMA foreign_key_check;
