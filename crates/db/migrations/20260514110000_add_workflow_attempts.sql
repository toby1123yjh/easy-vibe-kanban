PRAGMA foreign_keys = ON;

CREATE TABLE workflow_attempts (
    id             BLOB PRIMARY KEY,
    project_id     BLOB NOT NULL,
    issue_id       BLOB NOT NULL,
    workflow_id    BLOB NOT NULL,
    latest_run_id  BLOB,
    workspace_id   BLOB,
    name           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN (
                       'draft',
                       'ready',
                       'running',
                       'awaiting_human',
                       'awaiting_arena',
                       'cancelling',
                       'succeeded',
                       'failed',
                       'canceled'
                   )),
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id)    REFERENCES projects(id)       ON DELETE CASCADE,
    FOREIGN KEY (issue_id)      REFERENCES local_issues(id)   ON DELETE CASCADE,
    FOREIGN KEY (workflow_id)   REFERENCES workflows(id)      ON DELETE RESTRICT,
    FOREIGN KEY (latest_run_id) REFERENCES workflow_runs(id)  ON DELETE SET NULL,
    FOREIGN KEY (workspace_id)  REFERENCES workspaces(id)     ON DELETE SET NULL,
    UNIQUE (workflow_id)
);

CREATE INDEX idx_workflow_attempts_issue_id ON workflow_attempts(issue_id);
CREATE INDEX idx_workflow_attempts_project_issue
    ON workflow_attempts(project_id, issue_id);
CREATE INDEX idx_workflow_attempts_workflow_id ON workflow_attempts(workflow_id);
CREATE INDEX idx_workflow_attempts_latest_run_id ON workflow_attempts(latest_run_id);

ALTER TABLE workflow_runs
ADD COLUMN attempt_id BLOB REFERENCES workflow_attempts(id) ON DELETE SET NULL;

CREATE INDEX idx_workflow_runs_attempt_id ON workflow_runs(attempt_id);

PRAGMA foreign_key_check;
