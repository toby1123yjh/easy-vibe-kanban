PRAGMA foreign_keys = ON;

-- Product runtimes point at canonical orchestration/AgentRun identities.
-- These are deliberately separate from the legacy execution_process_id
-- projection; new Agent work must never overload that column.
--
-- Keep these product-table changes separate from the self-contained Agent
-- Runtime schema. Besides making the ownership boundary explicit, this lets
-- the runtime persistence tests exercise that schema without fabricating the
-- unrelated Workflow product tables.
ALTER TABLE workflow_runs ADD COLUMN orchestration_run_id BLOB
    REFERENCES orchestration_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_workflow_runs_orchestration_run_id
    ON workflow_runs(orchestration_run_id)
    WHERE orchestration_run_id IS NOT NULL;

ALTER TABLE node_executions ADD COLUMN orchestration_node_execution_id BLOB
    REFERENCES orchestration_node_executions(id) ON DELETE SET NULL;
ALTER TABLE node_executions ADD COLUMN agent_run_id BLOB
    REFERENCES agent_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_node_executions_orchestration_node_execution_id
    ON node_executions(orchestration_node_execution_id)
    WHERE orchestration_node_execution_id IS NOT NULL;
CREATE INDEX idx_node_executions_agent_run_id
    ON node_executions(agent_run_id);

PRAGMA foreign_key_check;
