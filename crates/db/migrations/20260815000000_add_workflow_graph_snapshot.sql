-- Workflow execution owns an immutable graph snapshot alongside the
-- canonical orchestration plan. New runtime dispatches populate this value
-- before any node can start.
ALTER TABLE workflow_runs ADD COLUMN graph_snapshot TEXT;

PRAGMA foreign_key_check;
