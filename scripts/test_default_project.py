"""Run real migrations in temporary databases; never read user data."""
import sqlite3
import unittest
import uuid
import prepare_dev_fixture as fixture

DEFAULT = uuid.UUID(int=3).bytes


class DefaultProjectTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        fixture.migrate(self.db, "2026-09-19T00:00:00Z")

    def session(self, workspace=None):
        workspace = workspace or uuid.uuid4().bytes
        self.db.execute("INSERT OR IGNORE INTO workspaces(id, branch, name) VALUES (?, 'direct-folder', 'Chat')", (workspace,))
        session = uuid.uuid4().bytes
        self.db.execute("INSERT INTO sessions(id, workspace_id, executor) VALUES (?, ?, 'CODEX')", (session, workspace))
        return session, workspace

    def test_default_exists_and_cannot_be_changed_or_deleted(self):
        self.assertEqual(self.db.execute("SELECT name FROM projects WHERE id=?", (DEFAULT,)).fetchone()[0], "默认项目")
        for statement in ("DELETE FROM projects WHERE id=?", "UPDATE projects SET name='oops' WHERE id=?", "UPDATE projects SET default_agent_working_dir='/oops' WHERE id=?"):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(statement, (DEFAULT,))

    def test_initial_assignment_is_inherited_and_project_deletion_never_rehomes(self):
        session, workspace = self.session()
        self.assertEqual(self.db.execute("SELECT project_id FROM session_project_memberships WHERE session_id=?", (session,)).fetchone()[0], DEFAULT)
        before = self.db.execute("SELECT * FROM sessions WHERE id=?", (session,)).fetchone()
        target = uuid.uuid4().bytes
        self.db.execute("INSERT INTO projects(id,name) VALUES (?, 'Target')", (target,))
        self.db.execute("UPDATE session_project_memberships SET project_id=? WHERE session_id=?", (target, session))
        self.assertEqual(self.db.execute("SELECT * FROM sessions WHERE id=?", (session,)).fetchone(), before)
        sibling, _ = self.session(workspace)
        self.assertEqual(self.db.execute("SELECT project_id FROM session_project_memberships WHERE session_id=?", (sibling,)).fetchone()[0], target)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM projects WHERE id=?", (target,))
        self.assertEqual(self.db.execute("SELECT project_id FROM session_project_memberships WHERE session_id=?", (session,)).fetchone()[0], target)
        self.assertEqual(self.db.execute("SELECT * FROM sessions WHERE id=?", (session,)).fetchone(), before)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.db.execute("DELETE FROM sessions WHERE id IN (?, ?)", (session, sibling))
        self.db.execute("DELETE FROM projects WHERE id=?", (target,))

    def test_started_and_finished_sessions_cannot_change_project(self):
        target = uuid.uuid4().bytes
        self.db.execute("INSERT INTO projects(id,name) VALUES (?, 'Target')", (target,))
        for status in ('running', 'succeeded', 'failed', 'cancelled'):
            session, workspace = self.session()
            self.db.execute("""
                INSERT INTO agent_runs (
                    id, session_id, workspace_id, request_id, idempotency_key,
                    correlation_id, schema_version, payload_version,
                    runtime_profile_id, provider_id, workspace_mode, workspace_path,
                    status, projection_status, request_envelope, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'test', 'codex', 'shared_workspace',
                    '/fixed', ?, 'current', '{}', '2026-09-20', '2026-09-20')
            """, (uuid.uuid4().bytes, session, workspace, uuid.uuid4().bytes,
                  str(uuid.uuid4()), uuid.uuid4().bytes, status))
            with self.assertRaisesRegex(sqlite3.IntegrityError, 'cannot change its project'):
                self.db.execute("UPDATE session_project_memberships SET project_id=? WHERE session_id=?", (target, session))
            self.assertEqual(self.db.execute("SELECT project_id FROM session_project_memberships WHERE session_id=?", (session,)).fetchone()[0], DEFAULT)

    def test_session_delete_cleans_membership_and_default_survives(self):
        session, _ = self.session()
        self.db.execute("DELETE FROM sessions WHERE id=?", (session,))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM session_project_memberships").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM projects WHERE id=?", (DEFAULT,)).fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
