-- Project deletion must never silently reassign a session whose cwd is fixed.
DROP TRIGGER IF EXISTS rehome_sessions_before_project_delete;

-- Creation assigns the project before publishing its first AgentRun. Afterwards
-- membership is immutable, including after the run finishes or fails.
CREATE TRIGGER protect_started_session_project
BEFORE UPDATE OF project_id ON session_project_memberships
WHEN NEW.project_id <> OLD.project_id
 AND EXISTS (SELECT 1 FROM agent_runs WHERE session_id = OLD.session_id)
BEGIN
    SELECT RAISE(ABORT, 'A started session cannot change its project');
END;
