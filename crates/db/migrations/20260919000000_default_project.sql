-- System-owned inbox. Its identity is stable; its directory is resolved from
-- configuration, never copied into a project workspace default.
INSERT INTO projects (id, name, created_at, updated_at) VALUES
    (X'00000000000000000000000000000003', '默认项目', '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z');
INSERT INTO local_project_metadata (project_id, organization_id, color, sort_order, created_at, updated_at)
VALUES (X'00000000000000000000000000000003', X'00000000000000000000000000000002', '210 80% 52%', -1, '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z');

CREATE TRIGGER protect_default_project_delete BEFORE DELETE ON projects
WHEN OLD.id = X'00000000000000000000000000000003'
BEGIN SELECT RAISE(ABORT, 'The default project cannot be deleted'); END;
CREATE TRIGGER protect_default_project_update BEFORE UPDATE OF id, name, default_agent_working_dir, remote_project_id ON projects
WHEN OLD.id = X'00000000000000000000000000000003'
BEGIN SELECT RAISE(ABORT, 'The default project is read-only'); END;

CREATE TABLE session_project_memberships (
    session_id BLOB PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    project_id BLOB NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
);
CREATE INDEX idx_session_project_memberships_project ON session_project_memberships(project_id);
CREATE TRIGGER rehome_sessions_before_project_delete BEFORE DELETE ON projects
WHEN OLD.id <> X'00000000000000000000000000000003'
BEGIN
    UPDATE session_project_memberships SET project_id = X'00000000000000000000000000000003'
    WHERE project_id = OLD.id;
END;
INSERT INTO session_project_memberships (session_id, project_id)
SELECT id, X'00000000000000000000000000000003' FROM sessions;
CREATE TRIGGER assign_session_default_project AFTER INSERT ON sessions
BEGIN
    INSERT INTO session_project_memberships (session_id, project_id)
    VALUES (NEW.id, COALESCE(
        (SELECT COALESCE(t.project_id, m.project_id)
         FROM sessions s
         JOIN session_project_memberships m ON m.session_id = s.id
         LEFT JOIN agent_task_bindings b ON b.session_id = s.id
         LEFT JOIN tasks t ON t.id = b.task_id
         WHERE s.workspace_id = NEW.workspace_id AND s.id <> NEW.id
         ORDER BY julianday(s.created_at) DESC, s.id LIMIT 1),
        X'00000000000000000000000000000003'));
END;
