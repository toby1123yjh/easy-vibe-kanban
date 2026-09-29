"""Lightweight SQLite checks for workflow file evidence ownership.

Runs without Cargo or a live Agent. Rust tests cover adapter and projection logic.
"""

import sqlite3
import unittest
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "crates/db/migrations/20260929000300_workflow_file_changes.sql"
)


class WorkflowFileEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE workflow_runs (id BLOB PRIMARY KEY, orchestration_run_id BLOB);
            CREATE TABLE agent_events (
                event_id BLOB PRIMARY KEY, agent_run_id BLOB,
                UNIQUE(event_id, agent_run_id)
            );
            CREATE TABLE orchestration_agent_run_links (
                orchestration_run_id BLOB, agent_run_id BLOB
            );
            INSERT INTO workflow_runs VALUES (X'01', X'11'), (X'02', X'12');
            INSERT INTO orchestration_agent_run_links VALUES
                (X'11', X'21'), (X'12', X'22');
            INSERT INTO agent_events VALUES (X'31', X'21'), (X'32', X'22');
            """
        )
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))

    def insert_evidence(self):
        self.db.execute(
            "INSERT INTO workflow_file_evidence_events VALUES (X'01', X'31', X'21')"
        )

    def test_rejects_other_workflows_agent_even_with_real_event(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "this workflow run"):
            self.db.execute(
                "INSERT INTO workflow_file_evidence_events VALUES (X'01', X'32', X'22')"
            )

    def test_rejects_forged_event_agent_pair(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO workflow_file_evidence_events VALUES (X'01', X'32', X'21')"
            )

    def test_evidence_replay_and_file_action_are_idempotent(self):
        self.insert_evidence()
        self.db.execute(
            "INSERT INTO workflow_file_evidence_events VALUES (X'01', X'31', X'21') "
            "ON CONFLICT(workflow_run_id, event_id) DO NOTHING"
        )
        for _ in range(2):
            self.db.execute(
                "INSERT INTO workflow_file_changes VALUES "
                "(X'01', X'31', 'report.bin', 'added') ON CONFLICT DO NOTHING"
            )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM workflow_file_changes").fetchone()[0],
            1,
        )

    def test_unattributed_changes_and_invalid_kinds_are_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO workflow_file_changes VALUES (X'01', X'31', 'x', 'added')"
            )
        self.insert_evidence()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO workflow_file_changes VALUES (X'01', X'31', 'x', 'guessed')"
            )

    def test_projection_has_no_file_contents_and_cascades_with_run(self):
        self.insert_evidence()
        self.db.execute(
            "INSERT INTO workflow_file_changes VALUES (X'01', X'31', 'gone.txt', 'deleted')"
        )
        columns = {
            row[1] for row in self.db.execute("PRAGMA table_info(workflow_file_changes)")
        }
        self.assertEqual(columns, {"workflow_run_id", "event_id", "path", "change_type"})
        self.db.execute("DELETE FROM workflow_runs WHERE id = X'01'")
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM workflow_file_changes").fetchone()[0],
            0,
        )
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
