-- AI Arena §6.1: project-level cap on the number of parallel attempts in
-- one race. Defaults to 3 (spec.md §6.1) with a hard ceiling of 6 enforced
-- at the API layer. Future Project Settings UI will expose this for tuning.
--
-- Stored on local_project_metadata so the existing Electric fallback shape
-- can ship the value to the frontend alongside `color` / `sort_order`.

PRAGMA foreign_keys = ON;

ALTER TABLE local_project_metadata
    ADD COLUMN arena_max_workspaces INTEGER NOT NULL DEFAULT 3
    CHECK (arena_max_workspaces BETWEEN 2 AND 6);

PRAGMA foreign_key_check;
