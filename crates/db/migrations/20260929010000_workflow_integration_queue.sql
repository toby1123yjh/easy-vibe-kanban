ALTER TABLE workflows ADD COLUMN external_enabled INTEGER NOT NULL DEFAULT 0 CHECK (external_enabled IN (0, 1));

CREATE TABLE workflow_attempt_sources (
    attempt_id BLOB PRIMARY KEY REFERENCES workflow_attempts(id) ON DELETE CASCADE,
    template_id BLOB NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
    template_revision INTEGER NOT NULL
);

CREATE TABLE workflow_run_queue (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id BLOB NOT NULL UNIQUE REFERENCES workflow_runs(id) ON DELETE CASCADE,
    project_id BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'queued' CHECK (phase IN ('queued','starting','active','finished')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec'))
);
CREATE INDEX idx_workflow_queue_project ON workflow_run_queue(project_id, phase, sequence);
CREATE TABLE workflow_project_slots (
    project_id BLOB PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    run_id BLOB NOT NULL UNIQUE REFERENCES workflow_runs(id) ON DELETE RESTRICT
);

-- A stable Node Task/Session may participate in multiple run/iteration records.
DROP INDEX idx_node_executions_task_id;
CREATE INDEX idx_node_executions_task_id ON node_executions(task_id) WHERE task_id IS NOT NULL;

-- The NodeExecution identity includes iteration. One decision can consume it.
CREATE TABLE workflow_interaction_responses (
    node_execution_id BLOB PRIMARY KEY REFERENCES node_executions(id) ON DELETE CASCADE,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec'))
);
