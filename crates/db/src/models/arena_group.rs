use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_mode", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaMode {
    #[default]
    Design,
    Implementation,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_lifecycle_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ArenaLifecycleStatus {
    #[default]
    Open,
    Closed,
    Adopted,
    ImplementationStarted,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_candidate_purpose", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaCandidatePurpose {
    #[default]
    Attempt,
    Synthesis,
}

/// Read-only UI projection for a candidate. This is never stored on Workspace;
/// winner identity and Workspace archive state are the canonical inputs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaStatus {
    #[default]
    Active,
    Promoted,
    Archived,
}

#[derive(Debug, Error)]
pub enum ArenaGroupError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Arena group not found")]
    NotFound,
    #[error("Arena candidate {candidate_id} does not belong to arena group {group_id}")]
    CandidateNotInGroup { group_id: Uuid, candidate_id: Uuid },
    #[error("Workspace {workspace_id} is not an Arena candidate in group {group_id}")]
    WorkspaceNotInGroup { group_id: Uuid, workspace_id: Uuid },
    #[error("Arena group {group_id} already has a winner")]
    AlreadyHasWinner { group_id: Uuid },
    #[error("Validation error: {0}")]
    ValidationError(String),
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ArenaGroup {
    pub id: Uuid,
    pub task_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub mode: ArenaMode,
    pub lifecycle_status: ArenaLifecycleStatus,
    pub winner_candidate_id: Option<Uuid>,
    pub promoted_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ArenaCandidate {
    pub id: Uuid,
    pub arena_group_id: Uuid,
    pub workspace_id: Uuid,
    pub purpose: ArenaCandidatePurpose,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CreateArenaGroup {
    pub id: Uuid,
    pub task_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub mode: ArenaMode,
}

#[derive(Debug, Clone)]
pub struct CreateArenaCandidate {
    pub id: Uuid,
    pub arena_group_id: Uuid,
    pub workspace_id: Uuid,
    pub purpose: ArenaCandidatePurpose,
    pub sort_order: i64,
}

const ARENA_GROUP_SELECT: &str = r#"
    SELECT id, task_id, prompt, base_branch, mode, lifecycle_status,
           winner_candidate_id, promoted_at, closed_at, created_at, updated_at
    FROM arena_groups
"#;

const ARENA_CANDIDATE_SELECT: &str = r#"
    SELECT id, arena_group_id, workspace_id, purpose, sort_order,
           created_at, updated_at
    FROM arena_candidates
"#;

impl ArenaGroup {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaGroup>(&format!("{ARENA_GROUP_SELECT} WHERE id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_active_by_issue_id(
        pool: &SqlitePool,
        issue_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaGroup>(&format!(
            "{ARENA_GROUP_SELECT}
             WHERE lifecycle_status = 'open'
               AND task_id IN (SELECT id FROM tasks WHERE issue_id = ?)
             ORDER BY updated_at DESC, id ASC
             LIMIT 1"
        ))
        .bind(issue_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_all_by_issue_id(
        pool: &SqlitePool,
        issue_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaGroup>(&format!(
            "{ARENA_GROUP_SELECT}
             WHERE task_id IN (SELECT id FROM tasks WHERE issue_id = ?)
             ORDER BY updated_at DESC, id ASC"
        ))
        .bind(issue_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_all_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaGroup>(&format!(
            "{ARENA_GROUP_SELECT}
             WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)
             ORDER BY updated_at DESC, id ASC"
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        connection: &mut SqliteConnection,
        data: &CreateArenaGroup,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ArenaGroup>(
            r#"
            INSERT INTO arena_groups (id, task_id, prompt, base_branch, mode)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id, task_id, prompt, base_branch, mode, lifecycle_status,
                      winner_candidate_id, promoted_at, closed_at,
                      created_at, updated_at
            "#,
        )
        .bind(data.id)
        .bind(data.task_id)
        .bind(&data.prompt)
        .bind(&data.base_branch)
        .bind(data.mode)
        .fetch_one(connection)
        .await
    }

    pub async fn select_winner(
        pool: &SqlitePool,
        group_id: Uuid,
        candidate_id: Uuid,
        lifecycle_status: ArenaLifecycleStatus,
    ) -> Result<(), ArenaGroupError> {
        if !matches!(
            lifecycle_status,
            ArenaLifecycleStatus::Adopted | ArenaLifecycleStatus::ImplementationStarted
        ) {
            return Err(ArenaGroupError::ValidationError(
                "winner selection requires adopted or implementation_started lifecycle".to_string(),
            ));
        }

        let candidate_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM arena_candidates
                 WHERE id = ? AND arena_group_id = ?
             )",
        )
        .bind(candidate_id)
        .bind(group_id)
        .fetch_one(pool)
        .await?;
        if !candidate_exists {
            return Err(ArenaGroupError::CandidateNotInGroup {
                group_id,
                candidate_id,
            });
        }

        let result = sqlx::query(
            r#"
            UPDATE arena_groups
            SET winner_candidate_id = ?,
                promoted_at = datetime('now', 'subsec'),
                lifecycle_status = ?,
                updated_at = datetime('now', 'subsec')
            WHERE id = ? AND winner_candidate_id IS NULL
            "#,
        )
        .bind(candidate_id)
        .bind(lifecycle_status)
        .bind(group_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 1 {
            return Ok(());
        }
        match Self::find_by_id(pool, group_id).await? {
            Some(_) => Err(ArenaGroupError::AlreadyHasWinner { group_id }),
            None => Err(ArenaGroupError::NotFound),
        }
    }

    pub async fn set_lifecycle_status(
        pool: &SqlitePool,
        group_id: Uuid,
        status: ArenaLifecycleStatus,
    ) -> Result<(), ArenaGroupError> {
        let result = sqlx::query(
            r#"
            UPDATE arena_groups
            SET lifecycle_status = ?,
                closed_at = CASE
                    WHEN ? = 'closed' THEN datetime('now', 'subsec')
                    ELSE closed_at
                END,
                updated_at = datetime('now', 'subsec')
            WHERE id = ?
            "#,
        )
        .bind(status)
        .bind(status)
        .bind(group_id)
        .execute(pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(ArenaGroupError::NotFound);
        }
        Ok(())
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM tasks WHERE id = (SELECT task_id FROM arena_groups WHERE id = ?)",
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}

impl ArenaCandidate {
    pub async fn create(
        connection: &mut SqliteConnection,
        data: &CreateArenaCandidate,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ArenaCandidate>(
            r#"
            INSERT INTO arena_candidates (
                id, arena_group_id, workspace_id, purpose, sort_order
            ) VALUES (?, ?, ?, ?, ?)
            RETURNING id, arena_group_id, workspace_id, purpose, sort_order,
                      created_at, updated_at
            "#,
        )
        .bind(data.id)
        .bind(data.arena_group_id)
        .bind(data.workspace_id)
        .bind(data.purpose)
        .bind(data.sort_order)
        .fetch_one(connection)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaCandidate>(&format!("{ARENA_CANDIDATE_SELECT} WHERE id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaCandidate>(&format!(
            "{ARENA_CANDIDATE_SELECT} WHERE workspace_id = ?"
        ))
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_in_group_by_workspace_id(
        pool: &SqlitePool,
        group_id: Uuid,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaCandidate>(&format!(
            "{ARENA_CANDIDATE_SELECT}
             WHERE arena_group_id = ? AND workspace_id = ?"
        ))
        .bind(group_id)
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn list_for_group(
        pool: &SqlitePool,
        group_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ArenaCandidate>(&format!(
            "{ARENA_CANDIDATE_SELECT}
             WHERE arena_group_id = ?
             ORDER BY sort_order ASC, id ASC"
        ))
        .bind(group_id)
        .fetch_all(pool)
        .await
    }

    pub async fn delete_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM arena_candidates WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        for statement in [
            "CREATE TABLE tasks (id BLOB PRIMARY KEY, project_id BLOB NOT NULL, issue_id BLOB NOT NULL)",
            r#"CREATE TABLE arena_groups (
                id BLOB PRIMARY KEY,
                task_id BLOB NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
                prompt TEXT NOT NULL,
                base_branch TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'implementation',
                lifecycle_status TEXT NOT NULL DEFAULT 'open',
                winner_candidate_id BLOB,
                promoted_at TEXT,
                closed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
            "CREATE TABLE workspaces (id BLOB PRIMARY KEY)",
            r#"CREATE TABLE arena_candidates (
                id BLOB PRIMARY KEY,
                arena_group_id BLOB NOT NULL REFERENCES arena_groups(id) ON DELETE CASCADE,
                workspace_id BLOB NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
                purpose TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                UNIQUE (arena_group_id, sort_order)
            )"#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create test schema");
        }
        pool
    }

    #[tokio::test]
    async fn winner_is_candidate_identity_not_workspace_metadata() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let issue_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let candidate_id = Uuid::new_v4();

        sqlx::query("INSERT INTO tasks (id, project_id, issue_id) VALUES (?, ?, ?)")
            .bind(task_id)
            .bind(project_id)
            .bind(issue_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO workspaces (id) VALUES (?)")
            .bind(workspace_id)
            .execute(&pool)
            .await
            .unwrap();

        let mut connection = pool.acquire().await.unwrap();
        ArenaGroup::create(
            &mut connection,
            &CreateArenaGroup {
                id: group_id,
                task_id,
                prompt: "Compare".to_string(),
                base_branch: "main".to_string(),
                mode: ArenaMode::Design,
            },
        )
        .await
        .unwrap();
        ArenaCandidate::create(
            &mut connection,
            &CreateArenaCandidate {
                id: candidate_id,
                arena_group_id: group_id,
                workspace_id,
                purpose: ArenaCandidatePurpose::Attempt,
                sort_order: 0,
            },
        )
        .await
        .unwrap();
        drop(connection);

        ArenaGroup::select_winner(&pool, group_id, candidate_id, ArenaLifecycleStatus::Adopted)
            .await
            .unwrap();

        let group = ArenaGroup::find_by_id(&pool, group_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(group.winner_candidate_id, Some(candidate_id));
    }
}
