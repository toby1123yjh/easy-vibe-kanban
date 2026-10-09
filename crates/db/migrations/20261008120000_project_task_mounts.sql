-- Host-local registration only. Business task content lives in the project file.
CREATE TABLE project_task_mounts (
    project_id BLOB PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    directory_path TEXT NOT NULL UNIQUE,
    indexed_revision INTEGER NOT NULL DEFAULT 0
);
