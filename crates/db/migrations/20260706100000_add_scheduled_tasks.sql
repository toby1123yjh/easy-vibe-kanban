PRAGMA foreign_keys = ON;

CREATE TABLE scheduled_tasks (
    id                 BLOB PRIMARY KEY,
    project_id         BLOB NOT NULL,
    target_type        TEXT NOT NULL
                       CHECK (target_type IN ('workflow')),
    target_id          BLOB NOT NULL,
    context_issue_id   BLOB NOT NULL,
    name               TEXT,
    enabled            INTEGER NOT NULL DEFAULT 1
                       CHECK (enabled IN (0, 1)),
    schedule_kind      TEXT NOT NULL
                       CHECK (schedule_kind IN ('daily', 'weekly')),
    time_of_day        TEXT NOT NULL,
    weekday            INTEGER
                       CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
    timezone           TEXT NOT NULL,
    input_text         TEXT NOT NULL DEFAULT '',
    concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_running'
                       CHECK (concurrency_policy IN ('skip_if_running')),
    last_run_id        BLOB,
    last_status        TEXT NOT NULL DEFAULT 'idle'
                       CHECK (last_status IN (
                           'idle',
                           'running',
                           'awaiting_human',
                           'awaiting_arena',
                           'succeeded',
                           'failed',
                           'skipped',
                           'canceled'
                       )),
    last_error         TEXT,
    last_triggered_at  TEXT,
    next_run_at        TEXT,
    claim_expires_at   TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id)       REFERENCES projects(id)      ON DELETE CASCADE,
    FOREIGN KEY (context_issue_id) REFERENCES local_issues(id)  ON DELETE CASCADE,
    FOREIGN KEY (last_run_id)      REFERENCES workflow_runs(id) ON DELETE SET NULL,
    UNIQUE (project_id, target_type, target_id),
    CHECK (
        (schedule_kind = 'daily' AND weekday IS NULL)
        OR (schedule_kind = 'weekly' AND weekday IS NOT NULL)
    )
);

CREATE INDEX idx_scheduled_tasks_project_id
    ON scheduled_tasks(project_id);
CREATE INDEX idx_scheduled_tasks_target
    ON scheduled_tasks(target_type, target_id);
CREATE INDEX idx_scheduled_tasks_due
    ON scheduled_tasks(enabled, next_run_at, claim_expires_at);
CREATE INDEX idx_scheduled_tasks_last_run_id
    ON scheduled_tasks(last_run_id);

PRAGMA foreign_key_check;
