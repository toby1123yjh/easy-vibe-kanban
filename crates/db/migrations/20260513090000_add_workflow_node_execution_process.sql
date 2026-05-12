PRAGMA foreign_keys = ON;

ALTER TABLE node_executions
ADD COLUMN execution_process_id BLOB REFERENCES execution_processes(id) ON DELETE SET NULL;

CREATE INDEX idx_node_executions_execution_process_id
ON node_executions(execution_process_id);
