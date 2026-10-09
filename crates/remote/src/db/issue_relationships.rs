// Private SQLx annotation name preserves the checked historical query hashes.
// The public Rust/Serde/TypeScript contract is Task-owned.
use api_types::{
    DeleteResponse, MutationResponse, TaskRelationship,
    TaskRelationshipType as IssueRelationshipType, TaskRelationshipType,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use super::get_txid;

#[derive(Debug, Error)]
pub enum IssueRelationshipError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

pub struct IssueRelationshipRepository;

impl IssueRelationshipRepository {
    pub async fn find_by_id(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<Option<TaskRelationship>, IssueRelationshipError> {
        let record = sqlx::query_as!(
            TaskRelationship,
            r#"
            SELECT
                id                AS "id!: Uuid",
                issue_id          AS "issue_id!: Uuid",
                related_issue_id  AS "related_issue_id!: Uuid",
                relationship_type AS "relationship_type!: IssueRelationshipType",
                created_at        AS "created_at!: DateTime<Utc>"
            FROM issue_relationships
            WHERE id = $1
            "#,
            id
        )
        .fetch_optional(pool)
        .await?;

        Ok(record)
    }

    pub async fn list_by_issue(
        pool: &PgPool,
        issue_id: Uuid,
    ) -> Result<Vec<TaskRelationship>, IssueRelationshipError> {
        let records = sqlx::query_as!(
            TaskRelationship,
            r#"
            SELECT
                id                AS "id!: Uuid",
                issue_id          AS "issue_id!: Uuid",
                related_issue_id  AS "related_issue_id!: Uuid",
                relationship_type AS "relationship_type!: IssueRelationshipType",
                created_at        AS "created_at!: DateTime<Utc>"
            FROM issue_relationships
            WHERE issue_id = $1
            "#,
            issue_id
        )
        .fetch_all(pool)
        .await?;

        Ok(records)
    }

    pub async fn list_by_project(
        pool: &PgPool,
        project_id: Uuid,
    ) -> Result<Vec<TaskRelationship>, IssueRelationshipError> {
        let records = sqlx::query_as!(
            TaskRelationship,
            r#"
            SELECT
                id                AS "id!: Uuid",
                issue_id          AS "issue_id!: Uuid",
                related_issue_id  AS "related_issue_id!: Uuid",
                relationship_type AS "relationship_type!: IssueRelationshipType",
                created_at        AS "created_at!: DateTime<Utc>"
            FROM issue_relationships
            WHERE issue_id IN (SELECT id FROM issues WHERE project_id = $1)
            "#,
            project_id
        )
        .fetch_all(pool)
        .await?;
        Ok(records)
    }

    pub async fn create(
        pool: &PgPool,
        id: Option<Uuid>,
        issue_id: Uuid,
        related_issue_id: Uuid,
        relationship_type: TaskRelationshipType,
    ) -> Result<MutationResponse<TaskRelationship>, IssueRelationshipError> {
        let id = id.unwrap_or_else(Uuid::new_v4);
        let mut tx = super::begin_tx(pool).await?;
        let data = sqlx::query_as!(
            TaskRelationship,
            r#"
            INSERT INTO issue_relationships (id, issue_id, related_issue_id, relationship_type)
            VALUES ($1, $2, $3, $4)
            RETURNING
                id                AS "id!: Uuid",
                issue_id          AS "issue_id!: Uuid",
                related_issue_id  AS "related_issue_id!: Uuid",
                relationship_type AS "relationship_type!: IssueRelationshipType",
                created_at        AS "created_at!: DateTime<Utc>"
            "#,
            id,
            issue_id,
            related_issue_id,
            relationship_type as TaskRelationshipType
        )
        .fetch_one(&mut *tx)
        .await?;
        let txid = get_txid(&mut *tx).await?;
        tx.commit().await?;
        Ok(MutationResponse { data, txid })
    }

    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<DeleteResponse, IssueRelationshipError> {
        let mut tx = super::begin_tx(pool).await?;
        sqlx::query!("DELETE FROM issue_relationships WHERE id = $1", id)
            .execute(&mut *tx)
            .await?;
        let txid = get_txid(&mut *tx).await?;
        tx.commit().await?;
        Ok(DeleteResponse { txid })
    }
}
