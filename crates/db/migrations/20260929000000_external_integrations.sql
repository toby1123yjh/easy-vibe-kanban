CREATE TABLE external_integrations (
    id BLOB PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    key_digest TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE TABLE external_integration_projects (
    integration_id BLOB NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
    project_id BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (integration_id, project_id)
);

-- Requests deliberately outlive their result. Retrying a deleted result must not
-- silently recreate it. context_json captures the allocation root before I/O.
CREATE TABLE external_integration_requests (
    integration_id BLOB NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    scope TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    resource_id BLOB NOT NULL,
    state TEXT NOT NULL DEFAULT 'preparing' CHECK (state IN ('preparing', 'complete')),
    context_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    PRIMARY KEY (integration_id, operation, scope, request_key)
);
