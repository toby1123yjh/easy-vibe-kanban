CREATE TABLE git_connections (
    id BLOB PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT NOT NULL,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('native', 'private_key')),
    fingerprint TEXT,
    has_passphrase INTEGER NOT NULL DEFAULT 0,
    secret_ciphertext BLOB,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE git_import_jobs (
    id BLOB PRIMARY KEY NOT NULL,
    request_id BLOB UNIQUE NOT NULL,
    request_json TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('native','imported')),
    writer_pid INTEGER,
    url TEXT NOT NULL,
    connection_id BLOB,
    branch TEXT,
    directory_path TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('queued','running','cancelling','succeeded','failed','cancelled')),
    phase TEXT NOT NULL,
    progress INTEGER,
    error TEXT,
    repo_id BLOB REFERENCES repos(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX git_import_connection_state ON git_import_jobs(connection_id, state);
