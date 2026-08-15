PRAGMA foreign_keys = ON;

CREATE TABLE workflows (
    id          BLOB PRIMARY KEY,
    source      TEXT NOT NULL CHECK (source IN ('system','project')),
    project_id  BLOB,
    name        TEXT NOT NULL,
    description TEXT,
    graph_json  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CHECK (
        (source = 'system' AND project_id IS NULL) OR
        (source = 'project' AND project_id IS NOT NULL)
    )
);

CREATE INDEX idx_workflows_project_id ON workflows(project_id);
CREATE INDEX idx_workflows_source ON workflows(source);

CREATE TABLE workflow_runs (
    id             BLOB PRIMARY KEY,
    workflow_id    BLOB NOT NULL,
    issue_id       BLOB NOT NULL,
    workspace_id   BLOB,
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    input_text     TEXT NOT NULL,
    output_text    TEXT,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                       'pending',
                       'running',
                       'awaiting_human',
                       'awaiting_arena',
                       'cancelling',
                       'succeeded',
                       'failed',
                       'canceled'
                   )),
    started_at     TEXT,
    finished_at    TEXT,
    error_text     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (workflow_id)  REFERENCES workflows(id)    ON DELETE RESTRICT,
    FOREIGN KEY (issue_id)     REFERENCES local_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)   ON DELETE SET NULL
);

CREATE INDEX idx_workflow_runs_issue_id ON workflow_runs(issue_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

CREATE TABLE node_executions (
    id             BLOB PRIMARY KEY,
    run_id         BLOB NOT NULL,
    node_id        TEXT NOT NULL,
    node_type      TEXT NOT NULL,
    iteration      INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                       'pending',
                       'running',
                       'awaiting_human',
                       'awaiting_arena',
                       'cancelling',
                       'succeeded',
                       'failed',
                       'cancelled',
                       'skipped'
                   )),
    input_text     TEXT,
    output_text    TEXT,
    session_id     BLOB,
    arena_group_id BLOB,
    tokens_used    INTEGER,
    cost_estimate  REAL,
    started_at     TEXT,
    finished_at    TEXT,
    error_text     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (run_id)         REFERENCES workflow_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id)     REFERENCES sessions(id)      ON DELETE SET NULL,
    FOREIGN KEY (arena_group_id) REFERENCES arena_groups(id)  ON DELETE SET NULL,
    UNIQUE (run_id, node_id, iteration)
);

CREATE INDEX idx_node_executions_run_id ON node_executions(run_id);
CREATE INDEX idx_node_executions_status ON node_executions(status);
CREATE INDEX idx_node_executions_arena_group_id ON node_executions(arena_group_id);

PRAGMA foreign_key_check;
