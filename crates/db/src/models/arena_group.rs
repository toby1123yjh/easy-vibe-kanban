use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

/// Status of a workspace within an arena race.
///
/// `arena_status` is orthogonal to the existing `workspaces.archived`
/// flag. `Archived` here means "this attempt lost the race / was retried
/// over"; `archived=true` retains its existing meaning of "user-driven
/// soft archive".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaStatus {
    #[default]
    Active,
    Promoted,
    Archived,
}

/// Product mode for an arena group.
///
/// Design mode is the v2 default: workspace-backed discussion with no
/// default commit. Implementation mode preserves the v1 diff/promote flow.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "arena_mode", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ArenaMode {
    #[default]
    Design,
    Implementation,
}

/// Product lifecycle for an arena group.
///
/// This replaces the v1 "promoted_workspace_id IS NULL means active"
/// proxy. A group can be closed without promotion and should no longer
/// block a new arena for the same issue.
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

#[derive(Debug, Error)]
pub enum ArenaGroupError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Arena group not found")]
    NotFound,
    #[error("Workspace {workspace_id} does not belong to arena group {group_id}")]
    WorkspaceNotInGroup { group_id: Uuid, workspace_id: Uuid },
    #[error("Arena group {group_id} has already been promoted")]
    AlreadyPromoted { group_id: Uuid },
    #[error("Validation error: {0}")]
    ValidationError(String),
}

/// A single AI Arena group: N workspace-backed attempts for one local
/// kanban issue. See `docs/future/ai-arena/spec-v2.md`.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ArenaGroup {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub mode: ArenaMode,
    pub lifecycle_status: ArenaLifecycleStatus,
    pub promoted_workspace_id: Option<Uuid>,
    pub implementation_workspace_id: Option<Uuid>,
    pub promoted_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateArenaGroup {
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub mode: ArenaMode,
}

impl ArenaGroup {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ArenaGroup,
            r#"SELECT id                    AS "id!: Uuid",
                      issue_id              AS "issue_id!: Uuid",
                      project_id            AS "project_id!: Uuid",
                      prompt,
                      base_branch,
                      mode                  AS "mode!: ArenaMode",
                      lifecycle_status      AS "lifecycle_status!: ArenaLifecycleStatus",
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      implementation_workspace_id AS "implementation_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
                      closed_at             AS "closed_at: DateTime<Utc>",
                      created_at            AS "created_at!: DateTime<Utc>",
                      updated_at            AS "updated_at!: DateTime<Utc>"
               FROM arena_groups
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find the most-recent open group for an issue.
    ///
    /// Used by the kanban-card -> arena-tab redirect. Closed design
    /// discussions no longer block new arena creation.
    pub async fn find_active_by_issue_id(
        pool: &SqlitePool,
        issue_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ArenaGroup,
            r#"SELECT id                    AS "id!: Uuid",
                      issue_id              AS "issue_id!: Uuid",
                      project_id            AS "project_id!: Uuid",
                      prompt,
                      base_branch,
                      mode                  AS "mode!: ArenaMode",
                      lifecycle_status      AS "lifecycle_status!: ArenaLifecycleStatus",
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      implementation_workspace_id AS "implementation_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
                      closed_at             AS "closed_at: DateTime<Utc>",
                      created_at            AS "created_at!: DateTime<Utc>",
                      updated_at            AS "updated_at!: DateTime<Utc>"
               FROM arena_groups
               WHERE issue_id = $1
                 AND lifecycle_status = 'open'
               ORDER BY created_at DESC
               LIMIT 1"#,
            issue_id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_all_by_issue_id(
        pool: &SqlitePool,
        issue_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ArenaGroup,
            r#"SELECT id                    AS "id!: Uuid",
                      issue_id              AS "issue_id!: Uuid",
                      project_id            AS "project_id!: Uuid",
                      prompt,
                      base_branch,
                      mode                  AS "mode!: ArenaMode",
                      lifecycle_status      AS "lifecycle_status!: ArenaLifecycleStatus",
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      implementation_workspace_id AS "implementation_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
                      closed_at             AS "closed_at: DateTime<Utc>",
                      created_at            AS "created_at!: DateTime<Utc>",
                      updated_at            AS "updated_at!: DateTime<Utc>"
               FROM arena_groups
               WHERE issue_id = $1
               ORDER BY created_at DESC"#,
            issue_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_all_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ArenaGroup,
            r#"SELECT id                    AS "id!: Uuid",
                      issue_id              AS "issue_id!: Uuid",
                      project_id            AS "project_id!: Uuid",
                      prompt,
                      base_branch,
                      mode                  AS "mode!: ArenaMode",
                      lifecycle_status      AS "lifecycle_status!: ArenaLifecycleStatus",
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      implementation_workspace_id AS "implementation_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
                      closed_at             AS "closed_at: DateTime<Utc>",
                      created_at            AS "created_at!: DateTime<Utc>",
                      updated_at            AS "updated_at!: DateTime<Utc>"
               FROM arena_groups
               WHERE project_id = $1
               ORDER BY created_at DESC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(pool: &SqlitePool, data: &CreateArenaGroup) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as!(
            ArenaGroup,
            r#"INSERT INTO arena_groups
                   (id, issue_id, project_id, prompt, base_branch, mode)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id                    AS "id!: Uuid",
                         issue_id              AS "issue_id!: Uuid",
                         project_id            AS "project_id!: Uuid",
                         prompt,
                         base_branch,
                         mode                  AS "mode!: ArenaMode",
                         lifecycle_status      AS "lifecycle_status!: ArenaLifecycleStatus",
                         promoted_workspace_id AS "promoted_workspace_id: Uuid",
                         implementation_workspace_id AS "implementation_workspace_id: Uuid",
                         promoted_at           AS "promoted_at: DateTime<Utc>",
                         closed_at             AS "closed_at: DateTime<Utc>",
                         created_at            AS "created_at!: DateTime<Utc>",
                         updated_at            AS "updated_at!: DateTime<Utc>""#,
            id,
            data.issue_id,
            data.project_id,
            data.prompt,
            data.base_branch,
            data.mode
        )
        .fetch_one(pool)
        .await
    }

    /// Mark the given workspace as the adopted/promoted attempt for this group.
    pub async fn set_promoted(
        pool: &SqlitePool,
        group_id: Uuid,
        promoted_workspace_id: Uuid,
    ) -> Result<(), ArenaGroupError> {
        let now = Utc::now();
        let result = sqlx::query!(
            r#"UPDATE arena_groups
                  SET promoted_workspace_id = $1,
                      promoted_at = $2,
                      lifecycle_status = 'adopted',
                      implementation_workspace_id = $1,
                      updated_at  = datetime('now', 'subsec')
               WHERE id = $3
                 AND promoted_workspace_id IS NULL"#,
            promoted_workspace_id,
            now,
            group_id
        )
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return match Self::find_by_id(pool, group_id).await? {
                Some(_) => Err(ArenaGroupError::AlreadyPromoted { group_id }),
                None => Err(ArenaGroupError::NotFound),
            };
        }
        Ok(())
    }

    pub async fn set_lifecycle_status(
        pool: &SqlitePool,
        group_id: Uuid,
        status: ArenaLifecycleStatus,
    ) -> Result<(), ArenaGroupError> {
        let closed_at = if status == ArenaLifecycleStatus::Closed {
            Some(Utc::now())
        } else {
            None
        };

        let result = sqlx::query!(
            r#"UPDATE arena_groups
                  SET lifecycle_status = $1,
                      closed_at = COALESCE($2, closed_at),
                      updated_at = datetime('now', 'subsec')
                WHERE id = $3"#,
            status,
            closed_at,
            group_id
        )
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(ArenaGroupError::NotFound);
        }

        Ok(())
    }

    pub async fn set_implementation_workspace(
        pool: &SqlitePool,
        group_id: Uuid,
        workspace_id: Uuid,
    ) -> Result<(), ArenaGroupError> {
        let result = sqlx::query!(
            r#"UPDATE arena_groups
                  SET implementation_workspace_id = $1,
                      lifecycle_status = 'implementation_started',
                      updated_at = datetime('now', 'subsec')
                WHERE id = $2"#,
            workspace_id,
            group_id
        )
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(ArenaGroupError::NotFound);
        }

        Ok(())
    }

    /// Delete a group. Workspaces still pointing at it have
    /// arena_group_id auto-cleared by ON DELETE SET NULL; their
    /// arena_status is left untouched (caller decides whether to
    /// archive them).
    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM arena_groups WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_arena_group_test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        for statement in [
            r#"
            CREATE TABLE projects (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE local_issues (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE workspaces (
                id BLOB PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE arena_groups (
                id BLOB PRIMARY KEY,
                issue_id BLOB NOT NULL,
                project_id BLOB NOT NULL,
                prompt TEXT NOT NULL,
                base_branch TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'implementation',
                lifecycle_status TEXT NOT NULL DEFAULT 'open',
                promoted_workspace_id BLOB,
                implementation_workspace_id BLOB,
                promoted_at TEXT,
                closed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create schema");
        }

        pool
    }

    async fn insert_project_and_issue(pool: &SqlitePool, project_id: Uuid, issue_id: Uuid) {
        sqlx::query("INSERT INTO projects (id, name) VALUES (?, ?)")
            .bind(project_id)
            .bind("Test Project")
            .execute(pool)
            .await
            .expect("insert project");

        sqlx::query("INSERT INTO local_issues (id, project_id, title) VALUES (?, ?, ?)")
            .bind(issue_id)
            .bind(project_id)
            .bind("Test Issue")
            .execute(pool)
            .await
            .expect("insert issue");
    }

    #[tokio::test]
    async fn active_group_lookup_ignores_closed_design_groups() {
        let pool = setup_arena_group_test_pool().await;
        let project_id = Uuid::new_v4();
        let issue_id = Uuid::new_v4();

        insert_project_and_issue(&pool, project_id, issue_id).await;

        let group = ArenaGroup::create(
            &pool,
            &CreateArenaGroup {
                issue_id,
                project_id,
                prompt: "Compare two designs".to_string(),
                base_branch: "main".to_string(),
                mode: ArenaMode::Design,
            },
        )
        .await
        .expect("create group");

        ArenaGroup::set_lifecycle_status(&pool, group.id, ArenaLifecycleStatus::Closed)
            .await
            .expect("close group");

        let active = ArenaGroup::find_active_by_issue_id(&pool, issue_id)
            .await
            .expect("active lookup");

        assert!(active.is_none());
    }
}
