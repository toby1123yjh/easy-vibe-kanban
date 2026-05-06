use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

/// Status of a workspace within an arena race.
///
/// `arena_status` is **orthogonal** to the existing `workspaces.archived`
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

/// A single AI Arena race: N workspaces racing the same prompt for one
/// kanban issue. See `docs/future/ai-arena/spec.md` §3.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ArenaGroup {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
    pub promoted_workspace_id: Option<Uuid>,
    pub promoted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateArenaGroup {
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub prompt: String,
    pub base_branch: String,
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
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
                      created_at            AS "created_at!: DateTime<Utc>",
                      updated_at            AS "updated_at!: DateTime<Utc>"
               FROM arena_groups
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find the most-recent un-promoted (active) group for an issue.
    /// Used by the kanban-card → arena-tab redirect: at most one active
    /// group per issue is expected.
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
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
                      created_at            AS "created_at!: DateTime<Utc>",
                      updated_at            AS "updated_at!: DateTime<Utc>"
               FROM arena_groups
               WHERE issue_id = $1 AND promoted_workspace_id IS NULL
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
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
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
                      promoted_workspace_id AS "promoted_workspace_id: Uuid",
                      promoted_at           AS "promoted_at: DateTime<Utc>",
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
                   (id, issue_id, project_id, prompt, base_branch)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id                    AS "id!: Uuid",
                         issue_id              AS "issue_id!: Uuid",
                         project_id            AS "project_id!: Uuid",
                         prompt,
                         base_branch,
                         promoted_workspace_id AS "promoted_workspace_id: Uuid",
                         promoted_at           AS "promoted_at: DateTime<Utc>",
                         created_at            AS "created_at!: DateTime<Utc>",
                         updated_at            AS "updated_at!: DateTime<Utc>""#,
            id,
            data.issue_id,
            data.project_id,
            data.prompt,
            data.base_branch
        )
        .fetch_one(pool)
        .await
    }

    /// Mark the given workspace as the promoted attempt for this group.
    /// Returns Err(AlreadyPromoted) if the group has already been promoted.
    /// Caller is expected to also flip arena_status on sibling workspaces
    /// to 'archived' and set workspaces.archived=true to trigger the 1h
    /// cleanup path; see `Workspace::set_arena_status` and existing
    /// `Workspace::set_archived`.
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
            // Either the group does not exist or it was already promoted.
            // Distinguish for a friendlier error.
            return match Self::find_by_id(pool, group_id).await? {
                Some(_) => Err(ArenaGroupError::AlreadyPromoted { group_id }),
                None => Err(ArenaGroupError::NotFound),
            };
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
