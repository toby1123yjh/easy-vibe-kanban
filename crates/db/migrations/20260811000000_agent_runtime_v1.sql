PRAGMA foreign_keys = ON;

CREATE TABLE agent_provider_sessions (
    id                    BLOB PRIMARY KEY,
    session_id            BLOB NOT NULL,
    schema_version        INTEGER NOT NULL CHECK (schema_version > 0),
    provider_id           TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
    runtime_profile_id    TEXT NOT NULL CHECK (length(trim(runtime_profile_id)) > 0),
    provider_session_id   TEXT NOT NULL CHECK (length(trim(provider_session_id)) > 0),
    session_reference     TEXT NOT NULL,
    observed_at           TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE (session_id, provider_id, runtime_profile_id),
    UNIQUE (provider_id, provider_session_id)
);

CREATE INDEX idx_agent_provider_sessions_session_id
    ON agent_provider_sessions(session_id);

CREATE TABLE agent_runs (
    id                    BLOB PRIMARY KEY,
    session_id            BLOB NOT NULL,
    workspace_id          BLOB NOT NULL,
    request_id            BLOB NOT NULL UNIQUE,
    idempotency_key       TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
    correlation_id        BLOB NOT NULL,
    schema_version        INTEGER NOT NULL CHECK (schema_version > 0),
    payload_version       INTEGER NOT NULL CHECK (payload_version > 0),
    runtime_profile_id    TEXT NOT NULL CHECK (length(trim(runtime_profile_id)) > 0),
    provider_id           TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
    workspace_mode        TEXT NOT NULL CHECK (workspace_mode IN (
                              'shared_workspace',
                              'isolated_worktree'
                          )),
    workspace_path        TEXT NOT NULL CHECK (length(trim(workspace_path)) > 0),
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'starting',
                              'running',
                              'awaiting_input',
                              'awaiting_approval',
                              'cancelling',
                              'succeeded',
                              'failed',
                              'cancelled',
                              'crashed',
                              'audit_failed'
                          )),
    projection_status     TEXT NOT NULL DEFAULT 'current' CHECK (projection_status IN (
                              'current',
                              'projection_degraded',
                              'rebuilding'
                          )),
    request_envelope      TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
    UNIQUE (id, session_id)
);

CREATE INDEX idx_agent_runs_session_id ON agent_runs(session_id);
CREATE INDEX idx_agent_runs_workspace_id ON agent_runs(workspace_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_correlation_id ON agent_runs(correlation_id);

CREATE TABLE agent_turns (
    id                    BLOB PRIMARY KEY,
    agent_run_id          BLOB NOT NULL UNIQUE,
    request_id            BLOB NOT NULL UNIQUE,
    turn_number           INTEGER NOT NULL DEFAULT 1 CHECK (turn_number > 0),
    intent                TEXT NOT NULL CHECK (intent IN ('initial','follow_up','review')),
    input_message         TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    UNIQUE (agent_run_id, turn_number),
    UNIQUE (id, agent_run_id)
);

CREATE INDEX idx_agent_turns_agent_run_id ON agent_turns(agent_run_id);

CREATE TABLE agent_run_attempts (
    id                    BLOB PRIMARY KEY,
    agent_run_id          BLOB NOT NULL,
    turn_id               BLOB NOT NULL,
    request_id            BLOB NOT NULL UNIQUE,
    idempotency_key       TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
    attempt_number        INTEGER NOT NULL CHECK (attempt_number > 0 AND attempt_number <= 4294967295),
    mode                  TEXT NOT NULL CHECK (mode IN ('launch','resume','restart')),
    transport             TEXT NOT NULL CHECK (transport IN (
                              'stdio_cli',
                              'stdio_rpc',
                              'acp',
                              'app_server_jsonrpc',
                              'http_sidecar',
                              'in_process'
                          )),
    schema_version        INTEGER NOT NULL CHECK (schema_version > 0),
    payload_version       INTEGER NOT NULL CHECK (payload_version > 0),
    capability_snapshot   TEXT NOT NULL,
    request_envelope      TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'starting',
                              'running',
                              'awaiting_input',
                              'awaiting_approval',
                              'cancelling',
                              'succeeded',
                              'failed',
                              'cancelled',
                              'crashed',
                              'audit_failed'
                          )),
    projection_status     TEXT NOT NULL DEFAULT 'current' CHECK (projection_status IN (
                              'current',
                              'projection_degraded',
                              'rebuilding'
                          )),
    started_at            TEXT,
    finished_at           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (turn_id, agent_run_id) REFERENCES agent_turns(id, agent_run_id) ON DELETE CASCADE,
    UNIQUE (agent_run_id, attempt_number),
    UNIQUE (id, agent_run_id),
    UNIQUE (id, agent_run_id, turn_id, attempt_number)
);

CREATE INDEX idx_agent_run_attempts_agent_run_id
    ON agent_run_attempts(agent_run_id);
CREATE INDEX idx_agent_run_attempts_status
    ON agent_run_attempts(status);

CREATE TABLE agent_process_registry (
    id                    BLOB PRIMARY KEY,
    run_attempt_id        BLOB NOT NULL UNIQUE,
    registry_status       TEXT NOT NULL DEFAULT 'reserved' CHECK (registry_status IN (
                              'reserved',
                              'spawned',
                              'running',
                              'exited',
                              'unreachable'
                          )),
    host_endpoint         TEXT,
    host_token            TEXT,
    host_instance_id      TEXT,
    host_pid              INTEGER,
    last_host_event_sequence INTEGER NOT NULL DEFAULT 0,
    supervisor_instance_id TEXT,
    pid                   INTEGER,
    process_group_id      INTEGER,
    process_started_at    TEXT,
    executable            TEXT,
    command_fingerprint   TEXT,
    exit_code             INTEGER,
    observed_exited_at    TEXT,
    lease_owner           TEXT,
    lease_expires_at      TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (run_attempt_id) REFERENCES agent_run_attempts(id) ON DELETE CASCADE,
    CHECK (pid IS NULL OR pid > 0),
    CHECK (host_pid IS NULL OR host_pid > 0),
    CHECK ((host_endpoint IS NULL) = (host_token IS NULL)),
    CHECK (last_host_event_sequence >= 0),
    CHECK (process_group_id IS NULL OR process_group_id > 0),
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
    CHECK (
        (registry_status = 'reserved'
            AND pid IS NULL
            AND process_started_at IS NULL
            AND observed_exited_at IS NULL
            AND exit_code IS NULL)
        OR
        (registry_status IN ('spawned', 'running', 'unreachable')
            AND pid IS NOT NULL
            AND process_started_at IS NOT NULL
            AND observed_exited_at IS NULL
            AND exit_code IS NULL)
        OR
        (registry_status = 'exited'
            AND pid IS NOT NULL
            AND process_started_at IS NOT NULL
            AND observed_exited_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_agent_process_registry_process_identity
    ON agent_process_registry(pid, process_started_at)
    WHERE pid IS NOT NULL AND process_started_at IS NOT NULL;
CREATE INDEX idx_agent_process_registry_status
    ON agent_process_registry(registry_status);

CREATE TABLE agent_events (
    event_id              BLOB PRIMARY KEY,
    session_id            BLOB NOT NULL,
    agent_run_id          BLOB NOT NULL,
    turn_id               BLOB NOT NULL,
    run_attempt_id        BLOB NOT NULL,
    run_attempt_number    INTEGER NOT NULL CHECK (run_attempt_number > 0 AND run_attempt_number <= 4294967295),
    sequence              INTEGER NOT NULL CHECK (sequence > 0),
    correlation_id        BLOB NOT NULL,
    schema_version        INTEGER NOT NULL CHECK (schema_version > 0),
    payload_version       INTEGER NOT NULL CHECK (payload_version > 0),
    event_envelope        TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id, session_id) REFERENCES agent_runs(id, session_id) ON DELETE CASCADE,
    FOREIGN KEY (turn_id, agent_run_id) REFERENCES agent_turns(id, agent_run_id) ON DELETE CASCADE,
    FOREIGN KEY (run_attempt_id, agent_run_id, turn_id, run_attempt_number)
        REFERENCES agent_run_attempts(id, agent_run_id, turn_id, attempt_number) ON DELETE CASCADE,
    UNIQUE (run_attempt_id, sequence),
    UNIQUE (event_id, agent_run_id)
);

CREATE INDEX idx_agent_events_agent_run_attempt_sequence
    ON agent_events(agent_run_id, run_attempt_number, sequence);
CREATE INDEX idx_agent_events_correlation_id
    ON agent_events(correlation_id);

CREATE TABLE agent_run_state (
    agent_run_id          BLOB PRIMARY KEY,
    state_schema_version  INTEGER NOT NULL CHECK (state_schema_version > 0),
    reducer_version       INTEGER NOT NULL CHECK (reducer_version > 0),
    last_run_attempt_id   BLOB,
    last_run_attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (last_run_attempt_number >= 0),
    last_event_sequence   INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
    last_event_id         BLOB,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'starting',
                              'running',
                              'awaiting_input',
                              'awaiting_approval',
                              'cancelling',
                              'succeeded',
                              'failed',
                              'cancelled',
                              'crashed',
                              'audit_failed'
                          )),
    projection_status     TEXT NOT NULL DEFAULT 'current' CHECK (projection_status IN (
                              'current',
                              'projection_degraded',
                              'rebuilding'
                          )),
    state_json            TEXT NOT NULL,
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (last_run_attempt_id) REFERENCES agent_run_attempts(id) ON DELETE SET NULL,
    FOREIGN KEY (last_event_id) REFERENCES agent_events(event_id) ON DELETE SET NULL,
    CHECK (
        (last_run_attempt_number = 0 AND last_event_sequence = 0)
        OR
        (last_run_attempt_number > 0 AND last_event_sequence > 0)
    )
);

CREATE INDEX idx_agent_run_state_status ON agent_run_state(status);
CREATE INDEX idx_agent_run_state_projection_status
    ON agent_run_state(projection_status);

CREATE TABLE agent_run_seen (
    agent_run_id          BLOB PRIMARY KEY,
    seen_at               TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE TABLE agent_run_launch_gates (
    agent_run_id          BLOB PRIMARY KEY,
    setup_execution_process_id BLOB UNIQUE,
    gate_status          TEXT NOT NULL DEFAULT 'waiting_setup_start' CHECK (gate_status IN (
                              'waiting_setup_start',
                              'waiting_setup',
                              'satisfied',
                              'failed'
                          )),
    setup_action         TEXT NOT NULL,
    failure_message      TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (setup_execution_process_id) REFERENCES execution_processes(id) ON DELETE SET NULL,
    CHECK (
        (gate_status = 'waiting_setup_start' AND setup_execution_process_id IS NULL)
        OR (gate_status IN ('waiting_setup', 'satisfied') AND setup_execution_process_id IS NOT NULL)
        OR gate_status = 'failed'
    )
);

CREATE INDEX idx_agent_run_launch_gates_status
    ON agent_run_launch_gates(gate_status, updated_at);

CREATE TABLE agent_run_commands (
    command_id            BLOB PRIMARY KEY,
    agent_run_id          BLOB NOT NULL,
    idempotency_key       TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
    command_schema_version INTEGER NOT NULL CHECK (command_schema_version > 0),
    command_envelope      TEXT NOT NULL,
    delivery_status       TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN (
                              'pending',
                              'delivering',
                              'delivered',
                              'failed'
                          )),
    delivery_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
    delivered_at          TEXT,
    last_error            TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_run_commands_delivery
    ON agent_run_commands(delivery_status, created_at);
CREATE INDEX idx_agent_run_commands_agent_run
    ON agent_run_commands(agent_run_id, created_at);

CREATE TABLE native_audit_streams (
    id                    BLOB PRIMARY KEY,
    session_id            BLOB NOT NULL,
    agent_run_id          BLOB NOT NULL,
    run_attempt_id        BLOB NOT NULL UNIQUE,
    audit_schema_version  INTEGER NOT NULL CHECK (audit_schema_version > 0),
    runtime_version       TEXT,
    protocol_version      TEXT,
    adapter_version       TEXT NOT NULL CHECK (length(trim(adapter_version)) > 0),
    mapper_version        TEXT NOT NULL CHECK (length(trim(mapper_version)) > 0),
    manifest_relative_path TEXT NOT NULL UNIQUE CHECK (length(trim(manifest_relative_path)) > 0),
    frames_relative_path  TEXT NOT NULL UNIQUE CHECK (length(trim(frames_relative_path)) > 0),
    first_sequence        INTEGER,
    last_sequence         INTEGER,
    final_checksum        TEXT,
    integrity_status      TEXT NOT NULL DEFAULT 'open' CHECK (integrity_status IN (
                              'open',
                              'complete',
                              'partial',
                              'corrupt',
                              'audit_failed',
                              'recovered'
                          )),
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    closed_at             TEXT,
    FOREIGN KEY (agent_run_id, session_id) REFERENCES agent_runs(id, session_id) ON DELETE CASCADE,
    FOREIGN KEY (run_attempt_id, agent_run_id)
        REFERENCES agent_run_attempts(id, agent_run_id) ON DELETE CASCADE,
    CHECK (
        (first_sequence IS NULL AND last_sequence IS NULL)
        OR
        (first_sequence > 0 AND last_sequence >= first_sequence)
    )
);

CREATE INDEX idx_native_audit_streams_agent_run_id
    ON native_audit_streams(agent_run_id);
CREATE INDEX idx_native_audit_streams_integrity_status
    ON native_audit_streams(integrity_status);

CREATE TABLE orchestration_runs (
    id                    BLOB PRIMARY KEY,
    request_id            BLOB NOT NULL UNIQUE,
    idempotency_key       TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
    correlation_id        BLOB NOT NULL,
    product_kind          TEXT NOT NULL CHECK (product_kind IN ('workflow','arena')),
    source_definition_id  BLOB NOT NULL,
    source_definition_version TEXT NOT NULL,
    plan_schema_version   INTEGER NOT NULL CHECK (plan_schema_version > 0),
    plan_snapshot         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'running',
                              'waiting_for_input',
                              'waiting_for_approval',
                              'cancelling',
                              'succeeded',
                              'failed',
                              'cancelled'
                          )),
    projection_status     TEXT NOT NULL DEFAULT 'current' CHECK (projection_status IN (
                              'current',
                              'projection_degraded',
                              'rebuilding'
                          )),
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_orchestration_runs_status ON orchestration_runs(status);
CREATE INDEX idx_orchestration_runs_source_definition
    ON orchestration_runs(product_kind, source_definition_id);

CREATE TABLE orchestration_node_executions (
    id                    BLOB PRIMARY KEY,
    orchestration_run_id  BLOB NOT NULL,
    node_key              TEXT NOT NULL,
    iteration             INTEGER NOT NULL DEFAULT 0 CHECK (iteration >= 0),
    stable_order          INTEGER NOT NULL CHECK (stable_order >= 0),
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'ready',
                              'running',
                              'awaiting_input',
                              'awaiting_approval',
                              'cancelling',
                              'succeeded',
                              'failed',
                              'cancelled'
                          )),
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    UNIQUE (orchestration_run_id, node_key, iteration),
    UNIQUE (id, orchestration_run_id)
);

CREATE INDEX idx_orchestration_node_executions_run_status
    ON orchestration_node_executions(orchestration_run_id, status);

CREATE TABLE orchestration_agent_run_links (
    id                    BLOB PRIMARY KEY,
    orchestration_run_id  BLOB NOT NULL,
    node_execution_id     BLOB NOT NULL,
    agent_run_id          BLOB NOT NULL,
    dispatch_idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(dispatch_idempotency_key)) > 0),
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (node_execution_id, orchestration_run_id)
        REFERENCES orchestration_node_executions(id, orchestration_run_id) ON DELETE CASCADE,
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE RESTRICT,
    UNIQUE (node_execution_id, agent_run_id),
    UNIQUE (orchestration_run_id, agent_run_id),
    UNIQUE (orchestration_run_id, node_execution_id, agent_run_id)
);

CREATE INDEX idx_orchestration_agent_run_links_agent_run_id
    ON orchestration_agent_run_links(agent_run_id);

CREATE TABLE orchestration_events (
    event_id              BLOB PRIMARY KEY,
    orchestration_run_id  BLOB NOT NULL,
    sequence              INTEGER NOT NULL CHECK (sequence > 0),
    correlation_id        BLOB NOT NULL,
    schema_version        INTEGER NOT NULL CHECK (schema_version > 0),
    payload_version       INTEGER NOT NULL CHECK (payload_version > 0),
    event_envelope        TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    UNIQUE (orchestration_run_id, sequence)
);

CREATE INDEX idx_orchestration_events_correlation_id
    ON orchestration_events(correlation_id);

CREATE TABLE orchestration_state (
    orchestration_run_id  BLOB PRIMARY KEY,
    state_schema_version  INTEGER NOT NULL CHECK (state_schema_version > 0),
    reducer_version       INTEGER NOT NULL CHECK (reducer_version > 0),
    last_event_sequence   INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
    last_event_id         BLOB,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'running',
                              'waiting_for_input',
                              'waiting_for_approval',
                              'cancelling',
                              'succeeded',
                              'failed',
                              'cancelled'
                          )),
    projection_status     TEXT NOT NULL DEFAULT 'current' CHECK (projection_status IN (
                              'current',
                              'projection_degraded',
                              'rebuilding'
                          )),
    state_json            TEXT NOT NULL,
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (last_event_id) REFERENCES orchestration_events(event_id) ON DELETE SET NULL
);

CREATE INDEX idx_orchestration_state_status ON orchestration_state(status);

CREATE TABLE orchestration_outbox (
    id                    BLOB PRIMARY KEY,
    orchestration_run_id  BLOB NOT NULL,
    node_execution_id     BLOB,
    command_id            BLOB NOT NULL UNIQUE,
    idempotency_key       TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
    command_schema_version INTEGER NOT NULL CHECK (command_schema_version > 0),
    command_envelope      TEXT NOT NULL,
    delivery_status       TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN (
                              'pending',
                              'delivering',
                              'delivered',
                              'failed'
                          )),
    delivery_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
    available_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    delivered_at          TEXT,
    last_error            TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (node_execution_id, orchestration_run_id)
        REFERENCES orchestration_node_executions(id, orchestration_run_id) ON DELETE CASCADE
);

CREATE INDEX idx_orchestration_outbox_delivery
    ON orchestration_outbox(delivery_status, available_at);

CREATE TABLE orchestration_inbox (
    id                    BLOB PRIMARY KEY,
    orchestration_run_id  BLOB NOT NULL,
    source_event_id       BLOB NOT NULL UNIQUE,
    source_agent_run_id   BLOB NOT NULL,
    source_sequence       INTEGER NOT NULL CHECK (source_sequence > 0),
    event_envelope        TEXT NOT NULL,
    consumption_status    TEXT NOT NULL DEFAULT 'pending' CHECK (consumption_status IN (
                              'pending',
                              'processing',
                              'consumed'
                          )),
    received_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    consumed_at           TEXT,
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_event_id, source_agent_run_id)
        REFERENCES agent_events(event_id, agent_run_id) ON DELETE CASCADE,
    FOREIGN KEY (orchestration_run_id, source_agent_run_id)
        REFERENCES orchestration_agent_run_links(orchestration_run_id, agent_run_id) ON DELETE CASCADE
);

CREATE INDEX idx_orchestration_inbox_consumption
    ON orchestration_inbox(orchestration_run_id, consumption_status, received_at);

CREATE TABLE orchestration_consumption (
    id                    BLOB PRIMARY KEY,
    orchestration_run_id  BLOB NOT NULL,
    join_node_execution_id BLOB NOT NULL,
    source_node_execution_id BLOB NOT NULL,
    source_agent_run_id   BLOB NOT NULL,
    source_event_id       BLOB NOT NULL,
    target_node_execution_id BLOB,
    consumed_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (join_node_execution_id, orchestration_run_id)
        REFERENCES orchestration_node_executions(id, orchestration_run_id) ON DELETE CASCADE,
    FOREIGN KEY (source_node_execution_id, orchestration_run_id)
        REFERENCES orchestration_node_executions(id, orchestration_run_id) ON DELETE CASCADE,
    FOREIGN KEY (orchestration_run_id, source_node_execution_id, source_agent_run_id)
        REFERENCES orchestration_agent_run_links(
            orchestration_run_id,
            node_execution_id,
            agent_run_id
        ) ON DELETE RESTRICT,
    FOREIGN KEY (source_event_id, source_agent_run_id)
        REFERENCES agent_events(event_id, agent_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_node_execution_id, orchestration_run_id)
        REFERENCES orchestration_node_executions(id, orchestration_run_id) ON DELETE RESTRICT,
    UNIQUE (join_node_execution_id, source_node_execution_id)
);

CREATE INDEX idx_orchestration_consumption_run_id
    ON orchestration_consumption(orchestration_run_id);

CREATE TABLE orchestration_leases (
    resource_kind         TEXT NOT NULL CHECK (resource_kind IN (
                              'dispatcher',
                              'inbox_consumer',
                              'reconciler',
                              'each_queue'
                          )),
    resource_id           BLOB NOT NULL,
    owner_id              TEXT NOT NULL,
    fencing_token         INTEGER NOT NULL CHECK (fencing_token > 0),
    acquired_at           TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    expires_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    PRIMARY KEY (resource_kind, resource_id)
);

CREATE INDEX idx_orchestration_leases_expires_at
    ON orchestration_leases(expires_at);

PRAGMA foreign_key_check;
