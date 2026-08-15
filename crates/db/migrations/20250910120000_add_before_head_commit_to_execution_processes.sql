-- Add before_head_commit column to store commit OID before a process starts
ALTER TABLE execution_processes
    ADD COLUMN before_head_commit TEXT;

-- No historical backfill is performed. Agent Runtime V1 starts from a clean
-- schema and records the boundary for each new standalone script process.
