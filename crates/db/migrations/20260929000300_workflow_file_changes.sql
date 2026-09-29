-- A rebuildable, content-free projection of canonical Agent file evidence.
CREATE TABLE workflow_file_collections (
    workflow_run_id BLOB PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
    project_root TEXT NOT NULL,
    collection_status TEXT NOT NULL CHECK (collection_status IN ('collecting', 'partial', 'unavailable')),
    reasons_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE workflow_file_evidence_events (
    workflow_run_id BLOB NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    event_id BLOB NOT NULL,
    agent_run_id BLOB NOT NULL,
    PRIMARY KEY (workflow_run_id, event_id),
    FOREIGN KEY (event_id, agent_run_id) REFERENCES agent_events(event_id, agent_run_id) ON DELETE CASCADE
);

CREATE TRIGGER workflow_file_evidence_owner
BEFORE INSERT ON workflow_file_evidence_events
WHEN NOT EXISTS (
    SELECT 1 FROM workflow_runs wr
    JOIN orchestration_agent_run_links link ON link.orchestration_run_id = wr.orchestration_run_id
    WHERE wr.id = NEW.workflow_run_id AND link.agent_run_id = NEW.agent_run_id
)
BEGIN
    SELECT RAISE(ABORT, 'file evidence must belong to this workflow run');
END;

CREATE TABLE workflow_file_changes (
    workflow_run_id BLOB NOT NULL,
    event_id BLOB NOT NULL,
    path TEXT NOT NULL CHECK (length(path) > 0),
    change_type TEXT NOT NULL CHECK (change_type IN ('added', 'modified', 'deleted')),
    PRIMARY KEY (workflow_run_id, event_id, path, change_type),
    FOREIGN KEY (workflow_run_id, event_id) REFERENCES workflow_file_evidence_events(workflow_run_id, event_id) ON DELETE CASCADE
);
