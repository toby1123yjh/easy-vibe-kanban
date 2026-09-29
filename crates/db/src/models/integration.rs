use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

/// Public metadata intentionally has no credential digest or plaintext key.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
pub struct ExternalIntegration {
    pub id: Uuid,
    pub name: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

impl ExternalIntegration {
    pub async fn list(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as("SELECT id, name, enabled, created_at FROM external_integrations ORDER BY created_at, id")
            .fetch_all(pool).await
    }

    pub async fn authenticate(
        pool: &SqlitePool,
        digest: &str,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT id FROM external_integrations WHERE key_digest = ? AND enabled = 1",
        )
        .bind(digest)
        .fetch_optional(pool)
        .await
    }

    pub async fn is_authorized(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM external_integration_projects p JOIN external_integrations i ON i.id = p.integration_id WHERE i.id = ? AND i.enabled = 1 AND p.project_id = ?)")
            .bind(id).bind(project_id).fetch_one(pool).await
    }

    pub async fn project_ids(pool: &SqlitePool, id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
        sqlx::query_scalar("SELECT project_id FROM external_integration_projects WHERE integration_id = ? ORDER BY project_id")
            .bind(id).fetch_all(pool).await
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct IntegrationRequest {
    pub resource_id: Uuid,
    pub request_hash: String,
    pub state: String,
    pub context_json: Option<String>,
}

impl IntegrationRequest {
    /// Reserve under the caller's transaction. On conflict, return the original
    /// identity; callers MUST compare request_hash before using or completing it.
    pub async fn reserve(
        conn: &mut SqliteConnection,
        integration_id: Uuid,
        operation: &str,
        scope: &str,
        key: &str,
        hash: &str,
        context: Option<&str>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query("INSERT INTO external_integration_requests (integration_id, operation, scope, request_key, request_hash, resource_id, context_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(integration_id, operation, scope, request_key) DO NOTHING")
            .bind(integration_id).bind(operation).bind(scope).bind(key).bind(hash).bind(Uuid::new_v4()).bind(context)
            .execute(&mut *conn).await?;
        sqlx::query_as("SELECT resource_id, request_hash, state, context_json FROM external_integration_requests WHERE integration_id = ? AND operation = ? AND scope = ? AND request_key = ?")
            .bind(integration_id).bind(operation).bind(scope).bind(key).fetch_one(conn).await
    }

    pub async fn complete(
        conn: &mut SqliteConnection,
        integration_id: Uuid,
        operation: &str,
        scope: &str,
        key: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE external_integration_requests SET state = 'complete' WHERE integration_id = ? AND operation = ? AND scope = ? AND request_key = ?")
            .bind(integration_id).bind(operation).bind(scope).bind(key).execute(conn).await?;
        Ok(())
    }
}
