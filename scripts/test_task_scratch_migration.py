"""Scratch terminology upgrade against real SQL in disposable memory databases."""
import json
from pathlib import Path
import sqlite3
import unittest
import uuid


MIGRATIONS = Path(__file__).resolve().parents[1] / "crates" / "db" / "migrations"
UPGRADE = (MIGRATIONS / "20261008130000_task_scratch_terminology.sql").read_text(encoding="utf-8")


class TaskScratchMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript((MIGRATIONS / "20251120000001_refactor_to_scratch.sql").read_text(encoding="utf-8"))

    def insert(self, identity, kind, data):
        self.db.execute(
            "INSERT INTO scratch(id,scratch_type,payload,created_at,updated_at) VALUES (?,?,?,'2026-09-01','2026-09-02')",
            (identity, kind, json.dumps({"type": kind, "data": data})),
        )

    def upgrade(self):
        self.db.executescript("BEGIN;\n" + UPGRADE + "\nCOMMIT;")

    def read(self, identity, kind):
        row = self.db.execute("SELECT payload,created_at,updated_at FROM scratch WHERE id=? AND scratch_type=?", (identity, kind)).fetchone()
        self.assertIsNotNone(row)
        payload = json.loads(row[0])
        self.assertEqual(payload["type"], kind)
        self.assertEqual(row[1:], ("2026-09-01", "2026-09-02"))
        return payload["data"]

    def test_same_identity_drafts_move_without_collision_or_content_replacement(self):
        identity = uuid.uuid4().bytes
        comment = 'Keep DRAFT_ISSUE, issue_id and "linked_issue" in my comment'
        task = {"title": "DRAFT_TASK issue_id", "status_id": "status", "project_id": "project", "parent_issue_id": "parent", "extension": {"issue_id": "authored"}}
        self.insert(identity, "DRAFT_TASK", comment)
        self.insert(identity, "DRAFT_ISSUE", task)
        self.upgrade()
        self.assertEqual(self.read(identity, "DRAFT_COMMENT"), comment)
        expected = dict(task)
        expected["parent_task_id"] = expected.pop("parent_issue_id")
        self.assertEqual(self.read(identity, "DRAFT_TASK"), expected)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM scratch").fetchone()[0], 2)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM scratch WHERE scratch_type='DRAFT_ISSUE'").fetchone()[0], 0)

    def test_workspace_links_keep_authoring_settings_and_attachments(self):
        identity = uuid.uuid4().bytes
        data = {"message": "Keep linked_issue in text", "repos": [], "directory_path": "F:/my-project", "executor_config": {"executor": "CODEX"}, "attachments": [{"id": "file", "file_path": "issue_id.txt"}], "linked_issue": {"issue_id": "task", "title": "Title", "simple_id": "ISSUE-1", "remote_project_id": "project"}}
        self.insert(identity, "DRAFT_WORKSPACE", data)
        self.upgrade()
        expected = dict(data)
        expected["linked_task"] = dict(expected.pop("linked_issue"))
        expected["linked_task"]["task_id"] = expected["linked_task"].pop("issue_id")
        self.assertEqual(self.read(identity, "DRAFT_WORKSPACE"), expected)

    def test_null_missing_current_and_unrelated_fields_are_preserved(self):
        null_task, missing_task, null_link, missing_link, current, unrelated = [uuid.uuid4().bytes for _ in range(6)]
        self.insert(null_task, "DRAFT_ISSUE", {"parent_issue_id": None})
        self.insert(missing_task, "DRAFT_ISSUE", {})
        self.insert(null_link, "DRAFT_WORKSPACE", {"linked_issue": None})
        self.insert(missing_link, "DRAFT_WORKSPACE", {"message": "Unlinked"})
        self.insert(current, "DRAFT_TASK", {"title": "Current", "parent_task_id": "parent"})
        self.insert(unrelated, "UI_PREFERENCES", {"linked_issue": "Not a draft link"})
        before = self.db.execute("SELECT payload FROM scratch WHERE id=?", (unrelated,)).fetchone()[0]
        self.upgrade()
        self.assertEqual(self.read(null_task, "DRAFT_TASK"), {"parent_task_id": None})
        self.assertEqual(self.read(missing_task, "DRAFT_TASK"), {})
        self.assertEqual(self.read(null_link, "DRAFT_WORKSPACE"), {"linked_task": None})
        self.assertEqual(self.read(missing_link, "DRAFT_WORKSPACE"), {"message": "Unlinked"})
        self.assertEqual(self.read(current, "DRAFT_TASK"), {"title": "Current", "parent_task_id": "parent"})
        self.assertEqual(self.db.execute("SELECT payload FROM scratch WHERE id=?", (unrelated,)).fetchone()[0], before)

    def test_conflicting_destination_fails_transaction_without_overwriting(self):
        identity = uuid.uuid4().bytes
        self.insert(identity, "DRAFT_TASK", "Old comment")
        self.insert(identity, "DRAFT_COMMENT", "Existing comment")
        before = self.db.execute("SELECT * FROM scratch ORDER BY scratch_type").fetchall()
        with self.assertRaises(sqlite3.IntegrityError):
            self.upgrade()
        self.db.rollback()
        self.assertEqual(self.db.execute("SELECT * FROM scratch ORDER BY scratch_type").fetchall(), before)


if __name__ == "__main__":
    unittest.main()
