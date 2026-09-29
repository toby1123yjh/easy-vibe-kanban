use db::models::integration::{ExternalIntegration, IntegrationRequest};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use uuid::Uuid;

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn caller(pool: &SqlitePool, digest: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO external_integrations (id, name, key_digest) VALUES (?, 'Caller', ?)")
        .bind(id)
        .bind(digest)
        .execute(pool)
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn grants_and_disabling_are_caller_specific_and_do_not_expose_digests() {
    let pool = pool().await;
    let a = caller(&pool, "digest-a").await;
    let b = caller(&pool, "digest-b").await;
    let project = Uuid::new_v4();
    sqlx::query("INSERT INTO projects (id, name) VALUES (?, 'Project')")
        .bind(project)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO external_integration_projects (integration_id, project_id) VALUES (?, ?)",
    )
    .bind(a)
    .bind(project)
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        ExternalIntegration::is_authorized(&pool, a, project)
            .await
            .unwrap()
    );
    assert!(
        !ExternalIntegration::is_authorized(&pool, b, project)
            .await
            .unwrap()
    );
    assert_eq!(
        ExternalIntegration::authenticate(&pool, "digest-a")
            .await
            .unwrap(),
        Some(a)
    );
    assert_eq!(
        ExternalIntegration::authenticate(&pool, "unknown")
            .await
            .unwrap(),
        None
    );
    sqlx::query("UPDATE external_integrations SET enabled = 0 WHERE id = ?")
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        ExternalIntegration::authenticate(&pool, "digest-a")
            .await
            .unwrap(),
        None
    );
    assert!(
        !ExternalIntegration::is_authorized(&pool, a, project)
            .await
            .unwrap()
    );
    assert_eq!(
        ExternalIntegration::authenticate(&pool, "digest-b")
            .await
            .unwrap(),
        Some(b)
    );
    let json = serde_json::to_string(&ExternalIntegration::list(&pool).await.unwrap()).unwrap();
    assert!(!json.contains("digest"));
    assert!(!json.contains("api_key"));
}

#[tokio::test]
async fn reservation_retries_preserve_identity_root_and_hash_across_transactions() {
    let pool = pool().await;
    let a = caller(&pool, "a").await;
    let b = caller(&pool, "b").await;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let initial = IntegrationRequest::reserve(
        &mut tx,
        a,
        "project.create",
        "",
        "one",
        "hash-a",
        Some("original-root"),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    // Represents a restart after allocation but before publishing the project.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let retry = IntegrationRequest::reserve(
        &mut tx,
        a,
        "project.create",
        "",
        "one",
        "changed-hash",
        Some("new-root"),
    )
    .await
    .unwrap();
    assert_eq!(initial.resource_id, retry.resource_id);
    assert_eq!(retry.request_hash, "hash-a");
    assert_eq!(retry.context_json.as_deref(), Some("original-root"));
    assert_eq!(retry.state, "preparing");
    let other =
        IntegrationRequest::reserve(&mut tx, b, "project.create", "", "one", "hash-a", None)
            .await
            .unwrap();
    assert_ne!(other.resource_id, initial.resource_id);
    IntegrationRequest::complete(&mut tx, a, "project.create", "", "one")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let complete =
        IntegrationRequest::reserve(&mut tx, a, "project.create", "", "one", "hash-a", None)
            .await
            .unwrap();
    assert_eq!(complete.state, "complete");
    assert_eq!(complete.resource_id, initial.resource_id);
}

#[tokio::test]
async fn rolled_back_completion_and_grant_are_not_published() {
    let pool = pool().await;
    let a = caller(&pool, "a").await;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let initial = IntegrationRequest::reserve(
        &mut tx,
        a,
        "project.create",
        "",
        "one",
        "hash",
        Some("root"),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    sqlx::query("INSERT INTO projects (id, name) VALUES (?, 'partial')")
        .bind(initial.resource_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO external_integration_projects (integration_id, project_id) VALUES (?, ?)",
    )
    .bind(a)
    .bind(initial.resource_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    IntegrationRequest::complete(&mut tx, a, "project.create", "", "one")
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    assert!(
        !ExternalIntegration::is_authorized(&pool, a, initial.resource_id)
            .await
            .unwrap()
    );
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let retry = IntegrationRequest::reserve(&mut tx, a, "project.create", "", "one", "hash", None)
        .await
        .unwrap();
    assert_eq!(retry.resource_id, initial.resource_id);
    assert_eq!(retry.state, "preparing");
}
