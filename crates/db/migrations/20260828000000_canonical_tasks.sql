-- Canonical execution Tasks.
--
-- This is intentionally a one-way convergence migration. It preserves
-- recognizable pre-release data, then removes the legacy Issue-shaped Task,
-- Workspace link, Workflow identity, and Arena name-inference structures.

COMMIT;
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE canonical_migration_assertion (
    violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);

-- The legacy Task rows were copied into local_issues by
-- 20260427000000_local_kanban.sql. Refuse to continue if that copy is not
-- complete instead of guessing Issue ownership.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM tasks legacy
LEFT JOIN local_issues issue ON issue.id = legacy.id
WHERE issue.id IS NULL;

CREATE TABLE tasks_new (
    id             BLOB PRIMARY KEY,
    project_id     BLOB NOT NULL,
    issue_id       BLOB NOT NULL,
    parent_task_id BLOB,
    title          TEXT NOT NULL CHECK (length(trim(title)) > 0),
    execution_kind TEXT NOT NULL CHECK (execution_kind IN ('agent','workflow','arena')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (issue_id) REFERENCES local_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_task_id, project_id, issue_id)
        REFERENCES tasks_new(id, project_id, issue_id) ON DELETE CASCADE,
    UNIQUE (id, project_id, issue_id)
);

-- Workflow attempts are top-level Workflow Tasks. Reusing the attempt UUID is
-- deterministic and keeps all pre-release deep links stable.
INSERT INTO tasks_new (
    id, project_id, issue_id, parent_task_id, title, execution_kind,
    created_at, updated_at
)
SELECT id, project_id, issue_id, NULL, trim(name), 'workflow',
       created_at, updated_at
FROM workflow_attempts;

-- Arena groups referenced by a Workflow Arena node become child Tasks;
-- standalone Arena groups remain top-level Tasks.
INSERT INTO tasks_new (
    id, project_id, issue_id, parent_task_id, title, execution_kind,
    created_at, updated_at
)
SELECT group_row.id,
       group_row.project_id,
       group_row.issue_id,
       (
           SELECT attempt.id
           FROM node_executions node
           JOIN workflow_runs run ON run.id = node.run_id
           JOIN workflow_attempts attempt ON attempt.id = run.attempt_id
           WHERE node.arena_group_id = group_row.id
           ORDER BY node.created_at ASC, node.id ASC
           LIMIT 1
       ),
       CASE
           WHEN length(trim(group_row.prompt)) > 0
               THEN substr(trim(group_row.prompt), 1, 160)
           ELSE 'Arena task'
       END,
       'arena', group_row.created_at, group_row.updated_at
FROM arena_groups group_row;

-- A group may only be owned by one Arena Node execution.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM (
    SELECT arena_group_id
    FROM node_executions
    WHERE arena_group_id IS NOT NULL
    GROUP BY arena_group_id
    HAVING COUNT(*) > 1
);

-- Existing Agent Node executions materialize child Agent Tasks. A task-bearing
-- node without an attempt or Session is ambiguous and intentionally aborts.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM node_executions node
LEFT JOIN workflow_runs run ON run.id = node.run_id
LEFT JOIN workflow_attempts attempt ON attempt.id = run.attempt_id
WHERE node.node_type = 'agent'
  AND (attempt.id IS NULL OR node.session_id IS NULL);

INSERT INTO tasks_new (
    id, project_id, issue_id, parent_task_id, title, execution_kind,
    created_at, updated_at
)
SELECT node.id,
       attempt.project_id,
       attempt.issue_id,
       attempt.id,
       COALESCE(NULLIF(trim(session.name), ''), NULLIF(trim(node.node_id), ''), 'Agent task'),
       'agent', node.created_at, node.updated_at
FROM node_executions node
JOIN workflow_runs run ON run.id = node.run_id
JOIN workflow_attempts attempt ON attempt.id = run.attempt_id
JOIN sessions session ON session.id = node.session_id
WHERE node.node_type = 'agent';

-- Standalone linked Sessions become Agent Tasks. Workflow backing workspaces,
-- Arena candidate workspaces, and Sessions already owned by NodeExecutions are
-- excluded so a Session can have exactly one Task identity.
INSERT INTO tasks_new (
    id, project_id, issue_id, parent_task_id, title, execution_kind,
    created_at, updated_at
)
SELECT session.id,
       link.project_id,
       link.issue_id,
       NULL,
       COALESCE(NULLIF(trim(session.name), ''), NULLIF(trim(workspace.name), ''), 'Agent task'),
       'agent', session.created_at, session.updated_at
FROM sessions session
JOIN workspaces workspace ON workspace.id = session.workspace_id
JOIN local_workspace_links link ON link.workspace_id = workspace.id
WHERE workspace.arena_group_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM workflow_attempts attempt
      WHERE attempt.workspace_id = workspace.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM node_executions node
      WHERE node.session_id = session.id
  );

-- A linked runtime container must be accounted for by a Session, Workflow, or
-- Arena candidate before the legacy link table is removed. Silently dropping
-- any other link would lose its Issue ownership without producing a Task.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM local_workspace_links link
WHERE NOT EXISTS (
          SELECT 1 FROM sessions session
          WHERE session.workspace_id = link.workspace_id
      )
  AND NOT EXISTS (
          SELECT 1 FROM workflow_attempts attempt
          WHERE attempt.workspace_id = link.workspace_id
      )
  AND NOT EXISTS (
          SELECT 1 FROM workspaces workspace
          WHERE workspace.id = link.workspace_id
            AND workspace.arena_group_id IS NOT NULL
      );

DROP TABLE task_attachments;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_project_updated_cursor
    ON tasks(project_id, julianday(updated_at) DESC, id);
CREATE INDEX idx_tasks_issue_top_level_updated_cursor
    ON tasks(
        project_id,
        issue_id,
        parent_task_id,
        julianday(updated_at) DESC,
        id
    );
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);

CREATE TRIGGER tasks_execution_kind_immutable
BEFORE UPDATE OF execution_kind ON tasks
WHEN NEW.execution_kind <> OLD.execution_kind
BEGIN
    SELECT RAISE(ABORT, 'tasks.execution_kind is immutable');
END;

CREATE TRIGGER tasks_issue_project_insert_guard
BEFORE INSERT ON tasks
WHEN NOT EXISTS (
    SELECT 1 FROM local_issues issue
    WHERE issue.id = NEW.issue_id AND issue.project_id = NEW.project_id
)
BEGIN
    SELECT RAISE(ABORT, 'task issue does not belong to task project');
END;

CREATE TRIGGER tasks_issue_project_update_guard
BEFORE UPDATE OF project_id, issue_id ON tasks
WHEN NOT EXISTS (
    SELECT 1 FROM local_issues issue
    WHERE issue.id = NEW.issue_id AND issue.project_id = NEW.project_id
)
BEGIN
    SELECT RAISE(ABORT, 'task issue does not belong to task project');
END;

CREATE TABLE agent_task_bindings (
    task_id    BLOB PRIMARY KEY,
    session_id BLOB NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

INSERT INTO agent_task_bindings (task_id, session_id, created_at)
SELECT task.id, task.id, task.created_at
FROM tasks task
JOIN sessions session ON session.id = task.id
WHERE task.execution_kind = 'agent'
  AND task.parent_task_id IS NULL;

INSERT INTO agent_task_bindings (task_id, session_id, created_at)
SELECT node.id, node.session_id, node.created_at
FROM node_executions node
JOIN tasks task ON task.id = node.id
WHERE task.execution_kind = 'agent';

-- Stage explicit Arena candidate identity while the legacy Workspace columns
-- are still available. Name inspection is confined to this one-time backfill.
CREATE TABLE arena_candidates_stage (
    id             BLOB PRIMARY KEY,
    arena_group_id BLOB NOT NULL,
    workspace_id   BLOB NOT NULL UNIQUE,
    purpose        TEXT NOT NULL CHECK (purpose IN ('attempt','synthesis')),
    sort_order     INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (arena_group_id, sort_order),
    UNIQUE (id, arena_group_id)
);

INSERT INTO arena_candidates_stage (
    id, arena_group_id, workspace_id, purpose, sort_order, created_at, updated_at
)
SELECT workspace.id,
       workspace.arena_group_id,
       workspace.id,
       CASE
           WHEN lower(COALESCE(workspace.name, '')) LIKE 'arena synthesis%'
               THEN 'synthesis'
           ELSE 'attempt'
       END,
       ROW_NUMBER() OVER (
           PARTITION BY workspace.arena_group_id
           ORDER BY workspace.created_at ASC, workspace.id ASC
       ) - 1,
       workspace.created_at,
       workspace.updated_at
FROM workspaces workspace
WHERE workspace.arena_group_id IS NOT NULL;

-- Every Arena group must retain at least one explicit candidate.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM arena_groups group_row
WHERE NOT EXISTS (
    SELECT 1 FROM arena_candidates_stage candidate
    WHERE candidate.arena_group_id = group_row.id
);

-- Legacy winner fields must point at a Workspace in the same group.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM arena_groups group_row
WHERE group_row.promoted_workspace_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM arena_candidates_stage candidate
      WHERE candidate.arena_group_id = group_row.id
        AND candidate.workspace_id = group_row.promoted_workspace_id
  );

CREATE TABLE arena_groups_new (
    id                  BLOB PRIMARY KEY,
    task_id             BLOB NOT NULL UNIQUE,
    prompt              TEXT NOT NULL,
    base_branch         TEXT NOT NULL,
    mode                TEXT NOT NULL DEFAULT 'implementation'
                        CHECK (mode IN ('design','implementation')),
    lifecycle_status    TEXT NOT NULL DEFAULT 'open'
                        CHECK (lifecycle_status IN (
                            'open','closed','adopted','implementation_started'
                        )),
    winner_candidate_id BLOB,
    promoted_at         TEXT,
    closed_at           TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (winner_candidate_id, id)
        REFERENCES arena_candidates(id, arena_group_id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO arena_groups_new (
    id, task_id, prompt, base_branch, mode, lifecycle_status,
    winner_candidate_id, promoted_at, closed_at, created_at, updated_at
)
SELECT id, id, prompt, base_branch, mode, lifecycle_status,
       promoted_workspace_id, promoted_at, closed_at, created_at, updated_at
FROM arena_groups;

DROP TABLE arena_groups;
ALTER TABLE arena_groups_new RENAME TO arena_groups;

CREATE TABLE arena_candidates (
    id             BLOB PRIMARY KEY,
    arena_group_id BLOB NOT NULL,
    workspace_id   BLOB NOT NULL UNIQUE,
    purpose        TEXT NOT NULL CHECK (purpose IN ('attempt','synthesis')),
    sort_order     INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (arena_group_id) REFERENCES arena_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    UNIQUE (arena_group_id, sort_order),
    UNIQUE (id, arena_group_id)
);

INSERT INTO arena_candidates
SELECT * FROM arena_candidates_stage;
DROP TABLE arena_candidates_stage;

CREATE INDEX idx_arena_groups_task_id ON arena_groups(task_id);
CREATE INDEX idx_arena_groups_lifecycle ON arena_groups(lifecycle_status);
CREATE INDEX idx_arena_candidates_group_order
    ON arena_candidates(arena_group_id, sort_order);

CREATE TABLE workflow_attempts_new (
    id            BLOB PRIMARY KEY,
    task_id       BLOB NOT NULL UNIQUE,
    workflow_id   BLOB NOT NULL UNIQUE,
    latest_run_id BLOB,
    workspace_id  BLOB,
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN (
                      'draft','ready','running','awaiting_human','awaiting_arena',
                      'cancelling','succeeded','failed','canceled'
                  )),
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE RESTRICT,
    FOREIGN KEY (latest_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

INSERT INTO workflow_attempts_new (
    id, task_id, workflow_id, latest_run_id, workspace_id, status,
    created_at, updated_at
)
SELECT id, id, workflow_id, latest_run_id, workspace_id, status,
       created_at, updated_at
FROM workflow_attempts;

DROP TABLE workflow_attempts;
ALTER TABLE workflow_attempts_new RENAME TO workflow_attempts;

CREATE INDEX idx_workflow_attempts_task_id ON workflow_attempts(task_id);
CREATE INDEX idx_workflow_attempts_latest_run_id ON workflow_attempts(latest_run_id);
CREATE INDEX idx_workflow_attempts_workspace_id ON workflow_attempts(workspace_id);

ALTER TABLE workflows ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision > 0);

ALTER TABLE node_executions ADD COLUMN task_id BLOB
    REFERENCES tasks(id) ON DELETE CASCADE;

UPDATE node_executions
SET task_id = CASE
    WHEN node_type = 'agent' THEN id
    WHEN node_type = 'arena' THEN arena_group_id
    ELSE NULL
END;

CREATE UNIQUE INDEX idx_node_executions_task_id
    ON node_executions(task_id) WHERE task_id IS NOT NULL;

-- Arena Nodes must bind the same child Task as their Arena group.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM node_executions node
LEFT JOIN arena_groups group_row ON group_row.id = node.arena_group_id
WHERE node.node_type = 'arena'
  AND (node.task_id IS NULL OR group_row.task_id <> node.task_id);

-- Workspaces are runtime containers only. Task and Arena identity now flows
-- through Session bindings or explicit candidates.
CREATE TABLE workspaces_new (
    id                  BLOB PRIMARY KEY,
    container_ref       TEXT,
    workspace_kind      TEXT NOT NULL DEFAULT 'worktree'
                        CHECK (workspace_kind IN ('worktree','direct_folder')),
    container_ownership TEXT NOT NULL DEFAULT 'managed'
                        CHECK (container_ownership IN ('managed','external')),
    branch              TEXT NOT NULL,
    setup_completed_at  TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    archived            INTEGER NOT NULL DEFAULT 0,
    pinned              INTEGER NOT NULL DEFAULT 0,
    name                TEXT,
    worktree_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO workspaces_new (
    id, container_ref, workspace_kind, container_ownership, branch,
    setup_completed_at, created_at, updated_at, archived, pinned, name,
    worktree_deleted
)
SELECT id, container_ref, workspace_kind, container_ownership, branch,
       setup_completed_at, created_at, updated_at, archived, pinned, name,
       worktree_deleted
FROM workspaces;

DROP TABLE workspaces;
ALTER TABLE workspaces_new RENAME TO workspaces;

CREATE INDEX idx_workspaces_created_at ON workspaces(created_at DESC);
CREATE INDEX idx_workspaces_updated_cursor ON workspaces(updated_at DESC, id);
CREATE INDEX idx_workspaces_container_ref
    ON workspaces(container_ref) WHERE container_ref IS NOT NULL;
CREATE INDEX idx_workspaces_container_ownership
    ON workspaces(container_ownership);

DROP TABLE local_workspace_links;

CREATE INDEX idx_projects_updated_cursor
    ON projects(julianday(updated_at) DESC, id);
CREATE INDEX idx_sessions_updated_cursor
    ON sessions(julianday(updated_at) DESC, id);

-- Recent-list timestamps represent real owned changes and runtime activity.
-- Reads, current selections, and seen acknowledgements never write these
-- entities, so they cannot reorder the Project/Session/Task cursors.
CREATE TRIGGER task_insert_touches_project
AFTER INSERT ON tasks
BEGIN
    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER task_title_change_touches_project
AFTER UPDATE OF title ON tasks
WHEN NEW.title <> OLD.title
BEGIN
    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER session_owned_change_touches_task_project
AFTER UPDATE OF name, executor, updated_at ON sessions
WHEN NEW.updated_at <> OLD.updated_at
BEGIN
    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT binding.task_id
        FROM agent_task_bindings binding
        WHERE binding.session_id = NEW.id
        UNION
        SELECT group_row.task_id
        FROM arena_candidates candidate
        JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
        WHERE candidate.workspace_id = NEW.workspace_id
    );

    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT child.parent_task_id
        FROM tasks child
        WHERE child.id IN (
            SELECT binding.task_id
            FROM agent_task_bindings binding
            WHERE binding.session_id = NEW.id
            UNION
            SELECT group_row.task_id
            FROM arena_candidates candidate
            JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
            WHERE candidate.workspace_id = NEW.workspace_id
        )
          AND child.parent_task_id IS NOT NULL
    );

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT task.project_id
        FROM tasks task
        WHERE task.id IN (
            SELECT binding.task_id
            FROM agent_task_bindings binding
            WHERE binding.session_id = NEW.id
            UNION
            SELECT group_row.task_id
            FROM arena_candidates candidate
            JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
            WHERE candidate.workspace_id = NEW.workspace_id
        )
    );
END;

CREATE TRIGGER agent_run_state_insert_touches_owners
AFTER INSERT ON agent_run_state
BEGIN
    UPDATE sessions
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (
        SELECT run.session_id FROM agent_runs run WHERE run.id = NEW.agent_run_id
    );

    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT binding.task_id
        FROM agent_runs run
        JOIN agent_task_bindings binding ON binding.session_id = run.session_id
        WHERE run.id = NEW.agent_run_id
        UNION
        SELECT group_row.task_id
        FROM agent_runs run
        JOIN arena_candidates candidate ON candidate.workspace_id = run.workspace_id
        JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
        WHERE run.id = NEW.agent_run_id
    );

    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT child.parent_task_id
        FROM tasks child
        WHERE child.id IN (
            SELECT binding.task_id
            FROM agent_runs run
            JOIN agent_task_bindings binding ON binding.session_id = run.session_id
            WHERE run.id = NEW.agent_run_id
            UNION
            SELECT group_row.task_id
            FROM agent_runs run
            JOIN arena_candidates candidate ON candidate.workspace_id = run.workspace_id
            JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
            WHERE run.id = NEW.agent_run_id
        )
          AND child.parent_task_id IS NOT NULL
    );

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT task.project_id
        FROM tasks task
        WHERE task.id IN (
            SELECT binding.task_id
            FROM agent_runs run
            JOIN agent_task_bindings binding ON binding.session_id = run.session_id
            WHERE run.id = NEW.agent_run_id
            UNION
            SELECT group_row.task_id
            FROM agent_runs run
            JOIN arena_candidates candidate ON candidate.workspace_id = run.workspace_id
            JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
            WHERE run.id = NEW.agent_run_id
        )
    );
END;

CREATE TRIGGER agent_run_state_update_touches_owners
AFTER UPDATE OF last_event_sequence, status, projection_status, state_json, updated_at
ON agent_run_state
WHEN NEW.updated_at <> OLD.updated_at
BEGIN
    UPDATE sessions
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (
        SELECT run.session_id FROM agent_runs run WHERE run.id = NEW.agent_run_id
    );

    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT binding.task_id
        FROM agent_runs run
        JOIN agent_task_bindings binding ON binding.session_id = run.session_id
        WHERE run.id = NEW.agent_run_id
        UNION
        SELECT group_row.task_id
        FROM agent_runs run
        JOIN arena_candidates candidate ON candidate.workspace_id = run.workspace_id
        JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
        WHERE run.id = NEW.agent_run_id
    );

    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT child.parent_task_id
        FROM tasks child
        WHERE child.id IN (
            SELECT binding.task_id
            FROM agent_runs run
            JOIN agent_task_bindings binding ON binding.session_id = run.session_id
            WHERE run.id = NEW.agent_run_id
            UNION
            SELECT group_row.task_id
            FROM agent_runs run
            JOIN arena_candidates candidate ON candidate.workspace_id = run.workspace_id
            JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
            WHERE run.id = NEW.agent_run_id
        )
          AND child.parent_task_id IS NOT NULL
    );

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id IN (
        SELECT task.project_id
        FROM tasks task
        WHERE task.id IN (
            SELECT binding.task_id
            FROM agent_runs run
            JOIN agent_task_bindings binding ON binding.session_id = run.session_id
            WHERE run.id = NEW.agent_run_id
            UNION
            SELECT group_row.task_id
            FROM agent_runs run
            JOIN arena_candidates candidate ON candidate.workspace_id = run.workspace_id
            JOIN arena_groups group_row ON group_row.id = candidate.arena_group_id
            WHERE run.id = NEW.agent_run_id
        )
    );
END;

CREATE TRIGGER workflow_attempt_runtime_touches_owners
AFTER UPDATE OF latest_run_id, workspace_id, status, updated_at ON workflow_attempts
WHEN NEW.updated_at <> OLD.updated_at
BEGIN
    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = NEW.task_id
       OR id = (SELECT parent_task_id FROM tasks WHERE id = NEW.task_id);

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (SELECT project_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER node_execution_runtime_touches_owners
AFTER UPDATE OF status, task_id, session_id, agent_run_id, arena_group_id, updated_at
ON node_executions
WHEN NEW.task_id IS NOT NULL AND NEW.updated_at <> OLD.updated_at
BEGIN
    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = NEW.task_id
       OR id = (SELECT parent_task_id FROM tasks WHERE id = NEW.task_id);

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (SELECT project_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER arena_group_runtime_touches_owners
AFTER UPDATE OF lifecycle_status, winner_candidate_id, promoted_at, closed_at, updated_at
ON arena_groups
WHEN NEW.updated_at <> OLD.updated_at
BEGIN
    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = NEW.task_id
       OR id = (SELECT parent_task_id FROM tasks WHERE id = NEW.task_id);

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (SELECT project_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER arena_candidate_runtime_touches_owners
AFTER INSERT ON arena_candidates
BEGIN
    UPDATE tasks
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (
        SELECT task_id FROM arena_groups WHERE id = NEW.arena_group_id
    )
       OR id = (
           SELECT parent_task_id
           FROM tasks
           WHERE id = (SELECT task_id FROM arena_groups WHERE id = NEW.arena_group_id)
       );

    UPDATE projects
    SET updated_at = CASE
        WHEN julianday(updated_at) < julianday(NEW.updated_at)
            THEN NEW.updated_at
        ELSE updated_at
    END
    WHERE id = (
        SELECT task.project_id
        FROM arena_groups group_row
        JOIN tasks task ON task.id = group_row.task_id
        WHERE group_row.id = NEW.arena_group_id
    );
END;

-- A canonical Task has one execution-kind binding. NodeExecution is an
-- additional materialization link for child Tasks and is not a subtype.
INSERT INTO canonical_migration_assertion
SELECT COUNT(*)
FROM tasks task
LEFT JOIN agent_task_bindings agent ON agent.task_id = task.id
LEFT JOIN workflow_attempts workflow ON workflow.task_id = task.id
LEFT JOIN arena_groups arena ON arena.task_id = task.id
WHERE (CASE WHEN agent.task_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN workflow.task_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN arena.task_id IS NULL THEN 0 ELSE 1 END) <> 1
   OR (task.execution_kind = 'agent' AND agent.task_id IS NULL)
   OR (task.execution_kind = 'workflow' AND workflow.task_id IS NULL)
   OR (task.execution_kind = 'arena' AND arena.task_id IS NULL);

INSERT INTO canonical_migration_assertion
SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE canonical_migration_assertion;
COMMIT;
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;
