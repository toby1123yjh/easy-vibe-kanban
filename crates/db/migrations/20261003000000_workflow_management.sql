-- An Attempt is the stable workflow instance. Never discard historical
-- executions to enforce the Issue singleton: abort with a retained-data
-- diagnosis if a developer database contains conflicting old instances.
CREATE TABLE workflow_management_migration_guard (ok INTEGER);
CREATE TRIGGER workflow_management_migration_guard_check
BEFORE INSERT ON workflow_management_migration_guard
WHEN EXISTS (
    SELECT 1 FROM workflow_attempts a JOIN tasks t ON t.id=a.task_id
    GROUP BY t.issue_id HAVING count(*) > 1
)
BEGIN
    SELECT RAISE(ABORT, 'Workflow instance upgrade blocked: multiple historical Attempts for one Issue; all history retained. Resolve the conflicting Issue bindings explicitly.');
END;
INSERT INTO workflow_management_migration_guard VALUES (1);
DROP TABLE workflow_management_migration_guard;

ALTER TABLE workflows ADD COLUMN main_agent_config_json TEXT;
ALTER TABLE workflows ADD COLUMN main_agent_prompt TEXT;
ALTER TABLE workflow_attempts ADD COLUMN issue_id BLOB REFERENCES local_issues(id) ON DELETE CASCADE;
UPDATE workflow_attempts SET issue_id=(SELECT issue_id FROM tasks WHERE id=workflow_attempts.task_id);
CREATE UNIQUE INDEX idx_workflow_instance_issue ON workflow_attempts(issue_id);
ALTER TABLE workflow_attempts ADD COLUMN main_session_id BLOB REFERENCES sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_workflow_instance_main_session ON workflow_attempts(main_session_id) WHERE main_session_id IS NOT NULL;
ALTER TABLE workflow_attempts ADD COLUMN main_session_bound_at TEXT;
ALTER TABLE workflow_attempts ADD COLUMN definition_locked_at TEXT;
ALTER TABLE workflow_attempts ADD COLUMN frozen_graph_json TEXT;
-- Existing executions have already accepted their definition.
UPDATE workflow_attempts SET
    definition_locked_at=(SELECT min(created_at) FROM workflow_runs WHERE attempt_id=workflow_attempts.id),
    frozen_graph_json=(SELECT graph_snapshot FROM workflow_runs WHERE attempt_id=workflow_attempts.id ORDER BY created_at,id LIMIT 1)
WHERE EXISTS(SELECT 1 FROM workflow_runs WHERE attempt_id=workflow_attempts.id);

CREATE TRIGGER workflow_instance_issue_insert AFTER INSERT ON workflow_attempts
BEGIN
    UPDATE workflow_attempts SET issue_id=(SELECT issue_id FROM tasks WHERE id=NEW.task_id) WHERE id=NEW.id;
END;
CREATE TRIGGER workflow_instance_issue_validate BEFORE INSERT ON workflow_attempts
WHEN NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.execution_kind='workflow')
BEGIN
    SELECT RAISE(ABORT, 'Workflow instance requires its canonical Workflow Task');
END;

CREATE TABLE workflow_main_session_bindings (
    session_id BLOB PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    workflow_id BLOB NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
    prepared_issue_id BLOB REFERENCES local_issues(id) ON DELETE RESTRICT,
    main_agent_config_json TEXT NOT NULL,
    main_agent_prompt TEXT NOT NULL,
    token_hash TEXT,
    actual_main_agent_run_id BLOB,
    actual_main_run_attempt_id BLOB,
    actual_main_turn_id BLOB,
    source_message_id BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','subsec'))
);
CREATE TABLE workflow_main_session_requests (
    project_id BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    workflow_id BLOB NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
    issue_id BLOB REFERENCES local_issues(id) ON DELETE RESTRICT,
    session_id BLOB NOT NULL,
    workspace_id BLOB REFERENCES workspaces(id) ON DELETE RESTRICT,
    main_agent_config_json TEXT NOT NULL,
    main_agent_prompt TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec')),
    PRIMARY KEY(project_id,request_id)
);
CREATE UNIQUE INDEX idx_workflow_prepared_main_issue ON workflow_main_session_bindings(prepared_issue_id) WHERE prepared_issue_id IS NOT NULL;
CREATE INDEX idx_workflow_main_request_issue ON workflow_main_session_requests(issue_id,created_at);

-- Preserve both accepted FIFO order and existing sqlite_sequence values.
ALTER TABLE workflow_run_queue RENAME TO workflow_run_queue_legacy;
DROP INDEX idx_workflow_queue_project;
CREATE TABLE workflow_run_queue (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id BLOB NOT NULL UNIQUE REFERENCES workflow_runs(id) ON DELETE CASCADE,
    project_id BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','waiting_for_source','stopping_source','starting','active','finished')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec'))
);
INSERT INTO workflow_run_queue SELECT * FROM workflow_run_queue_legacy;
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM sqlite_sequence WHERE name='workflow_run_queue_legacy'),0)) WHERE name='workflow_run_queue';
DROP TABLE workflow_run_queue_legacy;
CREATE INDEX idx_workflow_queue_project ON workflow_run_queue(project_id,phase,sequence);

CREATE TABLE workflow_run_submissions (
    run_id BLOB PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
    instance_id BLOB NOT NULL REFERENCES workflow_attempts(id) ON DELETE CASCADE,
    caller_namespace TEXT NOT NULL,
    request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('start','retry','rework')),
    material_paths_json TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    source_run_id BLOB REFERENCES workflow_runs(id) ON DELETE RESTRICT,
    source_node_execution_id BLOB REFERENCES node_executions(id) ON DELETE RESTRICT,
    source_message_id BLOB,
    active_policy TEXT CHECK(active_policy IN ('after_current','stop_then_run')),
    affected_nodes_json TEXT,
    planning_state TEXT NOT NULL DEFAULT 'pending' CHECK(planning_state IN ('pending','ready','failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec')),
    UNIQUE(caller_namespace,instance_id,request_id)
);
CREATE INDEX idx_workflow_submission_source ON workflow_run_submissions(source_run_id);
CREATE TABLE workflow_result_reuse (
    run_id BLOB NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    source_node_execution_id BLOB NOT NULL REFERENCES node_executions(id) ON DELETE RESTRICT,
    PRIMARY KEY(run_id,node_id,iteration)
);
-- An unselected branch is a plan disposition, not a fake executed Node.
CREATE TABLE workflow_node_dispositions (
    run_id BLOB NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition='skipped'),
    reason TEXT NOT NULL,
    PRIMARY KEY(run_id,node_id)
);
CREATE VIEW workflow_effective_node_executions AS
SELECT run_id,id AS source_node_execution_id,node_id,iteration,status,output_text,error_text FROM node_executions
UNION ALL
SELECT reuse.run_id,n.id,reuse.node_id,reuse.iteration,n.status,n.output_text,n.error_text
FROM workflow_result_reuse reuse JOIN node_executions n ON n.id=reuse.source_node_execution_id;
CREATE TABLE workflow_stop_intents (
    id BLOB PRIMARY KEY,
    caller_namespace TEXT NOT NULL,
    request_id TEXT NOT NULL,
    run_id BLOB NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    successor_run_id BLOB REFERENCES workflow_runs(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec')),
    delivered_at TEXT,
    UNIQUE(caller_namespace,run_id,request_id)
);
CREATE TABLE workflow_operation_requests (
    caller_namespace TEXT NOT NULL,
    operation TEXT NOT NULL,
    resource_id BLOB NOT NULL,
    request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec')),
    PRIMARY KEY(caller_namespace,operation,resource_id,request_id)
);

CREATE TABLE workflow_notifications (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id BLOB NOT NULL UNIQUE,
    instance_id BLOB NOT NULL REFERENCES workflow_attempts(id) ON DELETE CASCADE,
    run_id BLOB NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    main_session_id BLOB REFERENCES sessions(id) ON DELETE SET NULL,
    event_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    node_execution_id BLOB REFERENCES node_executions(id) ON DELETE CASCADE,
    interaction_id BLOB,
    observed_status TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','subsec'))
);
CREATE INDEX idx_workflow_notifications_session ON workflow_notifications(main_session_id,sequence);
-- Events are atomic with every lifecycle writer, including recovery and
-- canonical projection. Reading them never enqueues an Agent run.
CREATE TRIGGER workflow_run_terminal_notification AFTER UPDATE OF status ON workflow_runs
WHEN NEW.status IN ('succeeded','failed','canceled') AND OLD.status<>NEW.status AND NEW.attempt_id IS NOT NULL
BEGIN
    INSERT OR IGNORE INTO workflow_notifications(id,instance_id,run_id,main_session_id,event_key,kind,observed_status,summary)
    SELECT randomblob(16),a.id,NEW.id,a.main_session_id,'run:'||hex(NEW.id)||':terminal','run_terminal',NEW.status,
           CASE NEW.status WHEN 'succeeded' THEN 'Workflow completed' WHEN 'canceled' THEN 'Workflow stopped' ELSE coalesce(substr(NEW.error_text,1,2000),'Workflow failed') END
    FROM workflow_attempts a WHERE a.id=NEW.attempt_id;
END;
CREATE TRIGGER workflow_node_notification AFTER UPDATE OF status ON node_executions
WHEN NEW.status IN ('awaiting_human','awaiting_arena','failed') AND OLD.status<>NEW.status
BEGIN
    INSERT OR IGNORE INTO workflow_notifications(id,instance_id,run_id,main_session_id,event_key,kind,node_execution_id,interaction_id,observed_status,summary)
    SELECT randomblob(16),a.id,r.id,a.main_session_id,'node:'||hex(NEW.id)||':'||NEW.status,
           CASE NEW.status WHEN 'failed' THEN 'node_failed' ELSE 'interaction_required' END,
           NEW.id,CASE WHEN NEW.status IN ('awaiting_human','awaiting_arena') THEN NEW.id ELSE NULL END,NEW.status,
           CASE NEW.status WHEN 'failed' THEN coalesce(substr(NEW.error_text,1,2000),'Workflow node failed') ELSE 'Workflow is waiting for a decision' END
    FROM workflow_runs r JOIN workflow_attempts a ON a.id=r.attempt_id WHERE r.id=NEW.run_id;
END;
