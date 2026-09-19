"""Regression tests use temporary files only, never dev_assets or user data."""

import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import prepare_dev_fixture as fixture

SAMPLE_SOURCE = Path(__file__).parent / "fixtures/dev-fixture-sample.json"


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="vk-fixture-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.snapshot = self.directory / "seed.sqlite"
        fixture.build(self.snapshot)

    def sample_snapshot(self):
        sample = self.directory / "sample.sqlite"
        fixture.build(sample, source=SAMPLE_SOURCE)
        return sample

    def test_default_snapshot_has_only_schema_and_migration_history(self):
        second = self.directory / "empty-again.sqlite"
        fixture.build(second)
        self.assertEqual(fixture.logical_snapshot(self.snapshot), fixture.logical_snapshot(second))
        with sqlite3.connect(str(self.snapshot)) as connection:
            tables = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations'"
            )]
            for table in tables:
                with self.subTest(table=table):
                    self.assertEqual(connection.execute('SELECT COUNT(*) FROM "{}"'.format(table)).fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM _sqlx_migrations").fetchone()[0], len(list(fixture.migration_sources())))

    def test_sample_rebuild_has_identical_schema_rows_and_fixed_ids(self):
        sample = self.sample_snapshot()
        second = self.directory / "second.sqlite"
        fixture.build(second, source=SAMPLE_SOURCE)
        self.assertEqual(fixture.logical_snapshot(sample), fixture.logical_snapshot(second))
        with sqlite3.connect(str(second)) as connection:
            counts = {table: connection.execute('SELECT COUNT(*) FROM "{}"'.format(table)).fetchone()[0]
                      for table in ("projects", "local_issues", "tasks", "sessions", "workflows",
                                    "workflow_runs", "agent_events", "node_executions")}
            self.assertEqual(counts, dict(projects=2, local_issues=4, tasks=2, sessions=2,
                                          workflows=2, workflow_runs=1, agent_events=3, node_executions=3))
            self.assertEqual(connection.execute("SELECT id FROM agent_runs").fetchone()[0], fixture.identity("run").bytes)
            fixture.validate(connection)

    def test_runtime_envelopes_have_consistent_identity_and_final_event(self):
        with sqlite3.connect(str(self.sample_snapshot())) as connection:
            request = json.loads(connection.execute("SELECT request_envelope FROM agent_runs").fetchone()[0])
            attempt = json.loads(connection.execute("SELECT request_envelope FROM agent_run_attempts").fetchone()[0])
            state = json.loads(connection.execute("SELECT state_json FROM agent_run_state").fetchone()[0])
            events = [json.loads(row[0]) for row in connection.execute("SELECT event_envelope FROM agent_events ORDER BY sequence")]
            for key in ("session_id", "agent_run_id", "turn_id"):
                self.assertEqual(request[key], attempt[key])
                self.assertEqual(request[key], state[key])
                self.assertTrue(all(event[key] == request[key] for event in events))
            self.assertEqual(attempt["executor_config"]["executor"], request["runtime_profile_id"])
            self.assertEqual(attempt["workspace"], request["workspace"])
            self.assertEqual(request["workspace"]["path"], fixture.WORKSPACE)
            self.assertEqual([event["sequence"] for event in events], [1, 2, 3])
            self.assertEqual(state["last_event_id"], events[-1]["event_id"])
            self.assertEqual(state["status"], events[-1]["payload"]["data"]["status"])
            self.assertEqual(state["terminal_output"], events[1]["payload"]["data"]["message"])
            self.assertNotIn("provider_session", attempt)
            self.assertTrue(all(not event.get("native_refs") for event in events))

    def test_workflow_graph_and_execution_history_are_consistent(self):
        with sqlite3.connect(str(self.sample_snapshot())) as connection:
            graphs = [json.loads(row[0]) for row in connection.execute("SELECT graph_json FROM workflows")]
            self.assertEqual(graphs[0], graphs[1])
            graph = graphs[0]
            self.assertEqual(graph["version"], 2)
            self.assertEqual([node["type"] for node in graph["nodes"]], ["start", "transform", "end"])
            node_ids = {node["id"] for node in graph["nodes"]}
            self.assertTrue(all(edge["source"] in node_ids and edge["target"] in node_ids for edge in graph["edges"]))
            input_text, output_text, snapshot = connection.execute("SELECT input_text,output_text,graph_snapshot FROM workflow_runs").fetchone()
            self.assertEqual(graph, json.loads(snapshot))
            self.assertEqual(graph["nodes"][1]["data"]["template"].replace("{{input}}", input_text), output_text)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM node_executions WHERE session_id IS NOT NULL OR task_id IS NOT NULL").fetchone()[0], 0)

    def test_checksums_prove_lf_and_crlf_sources_equivalent(self):
        lf = self.directory / "lf"
        crlf = self.directory / "crlf"
        lf.mkdir()
        crlf.mkdir()
        text = "CREATE TABLE sample (id INTEGER);\n"
        (lf / "1_create_sample.sql").write_bytes(text.encode())
        (crlf / "1_create_sample.sql").write_bytes(text.replace("\n", "\r\n").encode())
        self.assertEqual(list(fixture.migration_sources(lf)), list(fixture.migration_sources(crlf)))
        with sqlite3.connect(":memory:") as connection:
            fixture.migrate(connection, "2026-09-19T00:00:00.000Z", crlf)
            self.assertEqual(connection.execute("SELECT checksum FROM _sqlx_migrations").fetchone()[0], hashlib.sha384(text.encode()).digest())

    def test_invalid_binding_active_status_and_real_path_are_rejected(self):
        sample = self.sample_snapshot()
        for sql in (
            "DELETE FROM agent_task_bindings",
            "UPDATE agent_runs SET status='running'",
            "UPDATE workspaces SET container_ref='C:/Users/example/private'",
        ):
            with self.subTest(sql=sql), sqlite3.connect(str(sample)) as connection:
                connection.execute(sql)
                with self.assertRaises(ValueError):
                    fixture.validate(connection)
                connection.rollback()

    def test_atomic_generation_failure_keeps_existing_snapshot(self):
        before = self.snapshot.read_bytes()
        with patch.object(fixture, "SNAPSHOT", self.snapshot), patch.object(fixture, "build", side_effect=ValueError("broken source")):
            with self.assertRaisesRegex(ValueError, "broken source"):
                fixture.prepare()
        self.assertEqual(before, self.snapshot.read_bytes())
        self.assertEqual(list(self.directory.glob(".fixture-*")), [])

    def test_check_detects_drift_missing_and_corrupt_snapshot_without_replacing_it(self):
        with patch.object(fixture, "SNAPSHOT", self.snapshot):
            fixture.prepare(check=True)
            with sqlite3.connect(str(self.snapshot)) as connection:
                connection.execute("INSERT INTO projects (id, name) VALUES (zeroblob(16), 'manual project')")
            before = self.snapshot.read_bytes()
            with self.assertRaisesRegex(ValueError, "differs"):
                fixture.prepare(check=True)
            self.assertEqual(before, self.snapshot.read_bytes())
        corrupt = self.directory / "corrupt.sqlite"
        corrupt.write_bytes(b"not a database")
        with self.assertRaises(sqlite3.DatabaseError):
            fixture.logical_snapshot(corrupt)
        missing = self.directory / "missing.sqlite"
        with patch.object(fixture, "SNAPSHOT", missing):
            with self.assertRaisesRegex(ValueError, "differs"):
                fixture.prepare(check=True)
        self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
