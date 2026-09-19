"""Build the development snapshot from public source, never from a user's DB.

The SQLx migrations are run transaction-by-transaction, including their explicit
COMMIT/BEGIN workaround for SQLite foreign-key toggles. Checksums are SHA384 of
LF SQL; debug startup verifies and adapts proven newline-only differences.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "crates/db/migrations"
SOURCE = ROOT / "dev_assets_seed/fixture.json"
SNAPSHOT = ROOT / "dev_assets_seed/db.v2.sqlite"
WORKSPACE = "@fixture-workspace@"
NAMESPACE = uuid.UUID("9266fc1c-1b69-4c45-aa28-516fc0975ee3")
EMPTY_TABLES = (
    "agent_process_registry", "agent_provider_sessions", "native_audit_streams",
    "execution_processes", "execution_process_logs", "git_connections",
    "git_import_jobs", "orchestration_runs", "orchestration_outbox",
    "orchestration_inbox", "orchestration_leases", "agent_run_commands",
    "agent_run_launch_gates", "scheduled_tasks", "managed_workspace_directories",
)


def identity(name):
    return uuid.uuid5(NAMESPACE, name)


def encoded(value):
    if isinstance(value, uuid.UUID):
        return value.bytes
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return value


def migration_sources(directory=MIGRATIONS):
    for path in sorted(directory.glob("*.sql")):
        version, description = path.stem.split("_", 1)
        sql = path.read_text(encoding="utf-8")  # universal newlines => LF
        yield int(version), description.replace("_", " "), sql


def migrate(connection, timestamp, directory=MIGRATIONS):
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("""CREATE TABLE _sqlx_migrations (
        version BIGINT PRIMARY KEY, description TEXT NOT NULL,
        installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN NOT NULL, checksum BLOB NOT NULL,
        execution_time BIGINT NOT NULL)""")
    for version, description, sql in migration_sources(directory):
        try:
            # executescript commits any existing transaction. Therefore BEGIN is
            # part of the script, not a surrounding Python connection context.
            connection.executescript("BEGIN;\n" + sql)
            connection.execute(
                "INSERT INTO _sqlx_migrations VALUES (?, ?, ?, 1, ?, 0)",
                (version, description, timestamp, hashlib.sha384(sql.encode()).digest()),
            )
            connection.commit()
        except sqlite3.Error as error:
            connection.rollback()
            raise ValueError("Migration {} failed: {}".format(version, error)) from error
    connection.execute("PRAGMA foreign_keys=ON")


def seed(connection, data):
    timestamp = data["timestamp"]

    def insert(table, **row):
        columns = {item[1] for item in connection.execute('PRAGMA table_info("{}")'.format(table))}
        for column in ("created_at", "updated_at"):
            if column in columns:
                row.setdefault(column, timestamp)
        connection.execute(
            'INSERT INTO "{}" ({}) VALUES ({})'.format(
                table, ",".join(row), ",".join("?" for _ in row)
            ), tuple(encoded(value) for value in row.values()),
        )

    # Migrations seed legacy templates with random UUIDs/current timestamps.
    # Remove those defaults even for an empty startup snapshot.
    connection.execute("DELETE FROM tags")
    if data.get("empty", False):
        return

    insert("tags", id=identity("prompt-tag"), tag_name="demo", content="Review this development example.")
    statuses = [("Todo", "210 80% 52%"), ("In Progress", "38 92% 50%"),
                ("In Review", "265 70% 62%"), ("Done", "145 63% 42%")]
    for number, name in enumerate(data["projects"]):
        project = identity("project-{}".format(number))
        insert("projects", id=project, name=name)
        insert("local_project_metadata", project_id=project,
               organization_id=uuid.UUID(int=2), color="210 80% 52%", sort_order=number)
        for index, (status, color) in enumerate(statuses):
            insert("local_project_statuses", id=identity("status-{}-{}".format(number, index)),
                   project_id=project, name=status, color=color, sort_order=(index + 1) * 100)
    project = identity("project-0")
    for index, issue in enumerate(data["issues"]):
        insert("local_issues", id=identity("issue-{}".format(index)), project_id=project,
               issue_number=index + 1, simple_id="DEMO-{}".format(index + 1),
               status_id=identity("status-0-{}".format(index)), sort_order=1000 + index,
               completed_at=timestamp if index == 3 else None, **issue)
    insert("local_tags", id=identity("issue-tag"), project_id=project,
           name="Demo", color="210 80% 52%")
    insert("local_issue_tags", id=identity("issue-tag-link"),
           issue_id=identity("issue-1"), tag_id=identity("issue-tag"))
    workspace = identity("workspace")
    insert("workspaces", id=workspace, container_ref=WORKSPACE,
           workspace_kind="direct_folder", container_ownership="external",
           branch="direct-folder", name="Demo workspace")
    session = identity("session-agent")
    insert("sessions", id=session, workspace_id=workspace, executor="CODEX",
           name=data["conversation"]["title"])
    insert("sessions", id=identity("session-standalone"), workspace_id=workspace,
           executor="CLAUDE_CODE", name=data["standalone_session"])
    insert("tasks", id=identity("task-agent"), project_id=project,
           issue_id=identity("issue-1"), title=data["conversation"]["title"], execution_kind="agent")
    insert("agent_task_bindings", task_id=identity("task-agent"), session_id=session)
    seed_history(insert, data, workspace, session)
    seed_workflow(insert, connection, data, project, workspace)
    insert("scratch", id=uuid.UUID(int=1), scratch_type="UI_PREFERENCES",
           payload={"type": "UI_PREFERENCES", "data": {"is_left_sidebar_visible": True}})


def seed_history(insert, data, workspace, session):
    """Synthetic canonical history, with no native session/process/audit claim."""
    stamp = data["timestamp"]
    ids = {key: str(identity(key)) for key in ("run", "turn", "attempt", "request", "correlation")}
    common = dict(schema_version=1, payload_version=1, session_id=str(session),
                  agent_run_id=ids["run"], turn_id=ids["turn"], correlation_id=ids["correlation"])
    context = dict(runtime_profile_id="CODEX", provider_id="codex",
                   workspace={"workspace_id": str(workspace), "mode": "shared_workspace", "path": WORKSPACE})
    user_message = dict(message_id=str(identity("user-message")), role="user", content=data["conversation"]["input"])
    final_message = dict(message_id=str(identity("final-message")), role="assistant", content=data["conversation"]["output"])
    request = dict(common, **context, request_id=ids["request"], idempotency_key="fixture:run",
                   intent="initial", input=user_message, created_at=stamp)
    insert("agent_runs", id=identity("run"), session_id=session, workspace_id=workspace,
           request_id=identity("request"), idempotency_key="fixture:run", correlation_id=identity("correlation"),
           schema_version=1, payload_version=1, runtime_profile_id="CODEX", provider_id="codex",
           workspace_mode="shared_workspace", workspace_path=WORKSPACE, status="succeeded", request_envelope=request)
    insert("agent_turns", id=identity("turn"), agent_run_id=identity("run"),
           request_id=identity("request"), intent="initial", input_message=user_message)
    capability = dict(schema_version=1, runtime_profile_id="CODEX", provider_id="codex",
                      adapter_version="fixture-synthetic", resolved_at=stamp, capabilities=[])
    attempt = dict(common, **context, request_id=str(identity("attempt-request")), idempotency_key="fixture:attempt",
                   run_attempt_id=ids["attempt"], attempt_number=1, mode="launch", transport="app_server_jsonrpc",
                   capability_snapshot=capability, executor_config={"executor": "CODEX"}, created_at=stamp)
    insert("agent_run_attempts", id=identity("attempt"), agent_run_id=identity("run"), turn_id=identity("turn"),
           request_id=identity("attempt-request"), idempotency_key="fixture:attempt", attempt_number=1,
           mode="launch", transport="app_server_jsonrpc", schema_version=1, payload_version=1,
           capability_snapshot=capability, request_envelope=attempt, status="succeeded", started_at=stamp, finished_at=stamp)
    payloads = [
        {"type": "lifecycle_changed", "data": {"status": "running"}},
        {"type": "message", "data": {"message": final_message, "final_output": True}},
        {"type": "lifecycle_changed", "data": {"status": "succeeded"}},
    ]
    for sequence, payload in enumerate(payloads, 1):
        event_id = identity("event-{}".format(sequence))
        event = dict(common, event_id=str(event_id), run_attempt_id=ids["attempt"], run_attempt_number=1,
                     sequence=sequence, timestamp=stamp, payload=payload)
        insert("agent_events", event_id=event_id, session_id=session, agent_run_id=identity("run"),
               turn_id=identity("turn"), run_attempt_id=identity("attempt"), run_attempt_number=1, sequence=sequence,
               correlation_id=identity("correlation"), schema_version=1, payload_version=1, event_envelope=event)
    state = dict(state_schema_version=1, reducer_version=1, session_id=str(session), agent_run_id=ids["run"],
                 turn_id=ids["turn"], status="succeeded", projection_status="current", last_run_attempt_id=ids["attempt"],
                 last_run_attempt_number=1, last_event_sequence=3, last_event_id=str(identity("event-3")),
                 terminal_output=final_message, unknown_event_count=0, updated_at=stamp)
    insert("agent_run_state", agent_run_id=identity("run"), state_schema_version=1, reducer_version=1,
           last_run_attempt_id=identity("attempt"), last_run_attempt_number=1, last_event_sequence=3,
           last_event_id=identity("event-3"), status="succeeded", state_json=state)


def seed_workflow(insert, connection, data, project, workspace):
    sample = data["workflow"]
    nodes = [
        {"id": "start", "type": "start", "data": {"display_name": "Start"}},
        {"id": "format", "type": "transform", "data": {"display_name": "Format text", "mode": "template", "template": "Demo: {{input}}"}},
        {"id": "end", "type": "end", "data": {"display_name": "End"}},
    ]
    for index, node in enumerate(nodes):
        node["position"] = {"x": 80 + index * 280, "y": 180}
    graph = {"version": 2, "nodes": nodes, "edges": [
        {"id": "start-format", "source": "start", "target": "format", "type": "default"},
        {"id": "format-end", "source": "format", "target": "end", "type": "default"},
    ]}
    insert("workflows", id=identity("workflow-template"), source="system", name=sample["name"],
           description=sample["description"], graph_json=graph)
    insert("workflows", id=identity("workflow"), source="project", project_id=project,
           name=sample["name"], description=sample["description"], graph_json=graph)
    insert("tasks", id=identity("task-workflow"), project_id=project, issue_id=identity("issue-2"),
           title=sample["name"], execution_kind="workflow")
    insert("workflow_attempts", id=identity("workflow-attempt"), task_id=identity("task-workflow"),
           workflow_id=identity("workflow"), workspace_id=workspace, status="succeeded")
    insert("workflow_runs", id=identity("workflow-run"), workflow_id=identity("workflow"),
           attempt_id=identity("workflow-attempt"), workspace_id=workspace, issue_id=identity("issue-2"),
           input_text=sample["input"], output_text=sample["output"], status="succeeded",
           started_at=data["timestamp"], finished_at=data["timestamp"], graph_snapshot=graph)
    connection.execute("UPDATE workflow_attempts SET latest_run_id=? WHERE id=?",
                       (identity("workflow-run").bytes, identity("workflow-attempt").bytes))
    for node in nodes:
        insert("node_executions", id=identity("node-" + node["id"]), run_id=identity("workflow-run"),
               node_id=node["id"], node_type=node["type"], status="succeeded", input_text=sample["input"],
               output_text=sample["input"] if node["id"] == "start" else sample["output"],
               started_at=data["timestamp"], finished_at=data["timestamp"])


def validate(connection):
    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("Fixture integrity check failed")
    if connection.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("Fixture foreign-key check failed")
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in EMPTY_TABLES:
        if table in tables and connection.execute('SELECT COUNT(*) FROM "{}"'.format(table)).fetchone()[0]:
            raise ValueError("Fixture must not contain rows in " + table)
    for table in ("agent_runs", "agent_run_attempts", "agent_run_state", "workflow_runs", "workflow_attempts", "node_executions"):
        if connection.execute('SELECT COUNT(*) FROM "{}" WHERE status <> ?'.format(table), ("succeeded",)).fetchone()[0]:
            raise ValueError("Fixture contains unfinished execution in " + table)
    if connection.execute("""SELECT count(*) FROM tasks t
        LEFT JOIN agent_task_bindings a ON a.task_id=t.id
        LEFT JOIN workflow_attempts w ON w.task_id=t.id
        LEFT JOIN arena_groups g ON g.task_id=t.id
        WHERE (a.task_id IS NOT NULL)+(w.task_id IS NOT NULL)+(g.task_id IS NOT NULL) <> 1
          OR (t.execution_kind='agent' AND a.task_id IS NULL)
          OR (t.execution_kind='workflow' AND w.task_id IS NULL)
          OR (t.execution_kind='arena' AND g.task_id IS NULL)""").fetchone()[0]:
        raise ValueError("Fixture has an invalid canonical Task binding")
    for (value,) in connection.execute("SELECT container_ref FROM workspaces UNION SELECT workspace_path FROM agent_runs"):
        if value != WORKSPACE:
            raise ValueError("Fixture must use the portable workspace marker")


def build(destination, source=SOURCE, migrations=MIGRATIONS):
    data = json.loads(source.read_text(encoding="utf-8"))
    if data["version"] != 1:
        raise ValueError("Unsupported fixture source version")
    connection = sqlite3.connect(str(destination))
    try:
        migrate(connection, data["timestamp"], migrations)
        with connection:
            seed(connection, data)
        validate(connection)
        connection.execute("VACUUM")
    finally:
        connection.close()


def logical_snapshot(path):
    # Compare logical data/schema, not SQLite-version-specific page layouts.
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        validate(connection)
        schema = connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").fetchall()
        rows = {}
        for kind, name, _, _ in schema:
            if kind == "table":
                rows[name] = sorted(connection.execute('SELECT * FROM "{}"'.format(name)).fetchall(), key=repr)
        return schema, rows
    finally:
        connection.close()


def prepare(check=False):
    # A sibling temporary directory guarantees atomic replacement on the same
    # volume. Failure never touches the previous checked-in seed or dev DB.
    with tempfile.TemporaryDirectory(prefix=".fixture-", dir=str(SNAPSHOT.parent)) as temporary:
        staged = Path(temporary) / "db.v2.sqlite"
        build(staged)
        connection = sqlite3.connect(str(staged))
        try:
            counts = [connection.execute('SELECT COUNT(*) FROM "{}"'.format(table)).fetchone()[0]
                      for table in ("projects", "local_issues", "tasks", "sessions")]
        finally:
            connection.close()
        if check:
            if not SNAPSHOT.is_file() or logical_snapshot(staged) != logical_snapshot(SNAPSHOT):
                raise ValueError("Fixture differs from migrations/source; run pnpm dev:fixture")
        else:
            os.replace(str(staged), str(SNAPSHOT))
    print("Development fixture {}: {} migrations; {} projects, {} issues, {} tasks, {} sessions; integrity/FKs OK".format(
        "checked" if check else "generated", len(list(migration_sources())), *counts))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        prepare(args.check)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, "Fixture error: {}\n".format(error))
