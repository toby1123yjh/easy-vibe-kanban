use std::{str::FromStr, sync::Arc};

use sqlx::{
    ConnectOptions, Error, Pool, Sqlite, SqlitePool,
    migrate::MigrateError,
    sqlite::{SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions},
};
use utils::assets::asset_dir;

pub mod models;

async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), Error> {
    use std::collections::HashSet;

    let migrator = sqlx::migrate!("./migrations");
    let mut processed_versions: HashSet<i64> = HashSet::new();

    loop {
        match migrator.run(pool).await {
            Ok(()) => {
                guard_agent_runtime_schema(pool).await?;
                return Ok(());
            }
            Err(MigrateError::VersionMismatch(version)) => {
                if cfg!(debug_assertions) {
                    // return the error in debug mode to catch migration issues early
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }

                if !cfg!(windows) {
                    // On non-Windows platforms, we do not attempt to auto-fix checksum mismatches
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }

                // Guard against infinite loop
                if !processed_versions.insert(version) {
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }

                // On Windows, there can be checksum mismatches due to line ending differences
                // or other platform-specific issues. Update the stored checksum and retry.
                tracing::warn!(
                    "Migration version {} has checksum mismatch, updating stored checksum (likely platform-specific difference)",
                    version
                );

                // Find the migration with the mismatched version and get its current checksum
                if let Some(migration) = migrator.iter().find(|m| m.version == version) {
                    // Update the checksum in _sqlx_migrations to match the current file
                    sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
                        .bind(&*migration.checksum)
                        .bind(version)
                        .execute(pool)
                        .await?;
                } else {
                    // Migration not found in current set, can't fix
                    return Err(sqlx::Error::Migrate(Box::new(
                        MigrateError::VersionMismatch(version),
                    )));
                }
            }
            Err(e) => return Err(e.into()),
        }
    }
}

/// Verifies the minimum process-registry shape required to start Agent Runtime
/// and repairs the one known safe drift: legacy databases without
/// `agent_process_registry.updated_at`.
///
/// This deliberately is not a general schema-diff engine. Structural changes
/// that need data conversion or constraint changes belong in a new forward
/// migration and fail here before background runtime services can start.
async fn guard_agent_runtime_schema(pool: &Pool<Sqlite>) -> Result<(), Error> {
    let table_exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_process_registry'",
    )
    .fetch_optional(pool)
    .await?;

    if table_exists.is_none() {
        return Err(Error::Protocol(
            "agent runtime schema guard failed: missing agent_process_registry table".to_owned(),
        ));
    }

    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('agent_process_registry')")
            .fetch_all(pool)
            .await?;
    let missing_required_columns = [
        "id",
        "run_attempt_id",
        "registry_status",
        "last_host_event_sequence",
        "created_at",
    ]
    .into_iter()
    .filter(|required| !columns.iter().any(|column| column == required))
    .collect::<Vec<_>>();
    if !missing_required_columns.is_empty() {
        return Err(Error::Protocol(format!(
            "agent runtime schema guard failed: agent_process_registry is missing required columns: {}",
            missing_required_columns.join(", ")
        )));
    }

    let has_updated_at = columns.iter().any(|column| column == "updated_at");
    if !has_updated_at {
        // SQLite does not allow a non-constant expression as the default of a
        // column added with ALTER TABLE. Add it nullable, backfill existing
        // rows, and have the persistence layer provide the value for future
        // inserts.
        sqlx::query("ALTER TABLE agent_process_registry ADD COLUMN updated_at TEXT")
            .execute(pool)
            .await?;
    }

    let result = sqlx::query(
        "UPDATE agent_process_registry
         SET updated_at = COALESCE(created_at, datetime('now', 'subsec'))
         WHERE updated_at IS NULL",
    )
    .execute(pool)
    .await?;

    if !has_updated_at || result.rows_affected() > 0 {
        tracing::warn!(
            backfilled_rows = result.rows_affected(),
            added_column = !has_updated_at,
            "repaired legacy agent_process_registry schema"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::guard_agent_runtime_schema;

    #[tokio::test]
    async fn repairs_legacy_process_registry_updated_at_column() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        sqlx::query(
            "CREATE TABLE agent_process_registry (
                id BLOB PRIMARY KEY,
                run_attempt_id BLOB NOT NULL UNIQUE,
                registry_status TEXT NOT NULL DEFAULT 'reserved',
                last_host_event_sequence INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )",
        )
        .execute(&pool)
        .await
        .expect("create legacy process registry");
        sqlx::query(
            "INSERT INTO agent_process_registry (id, run_attempt_id) VALUES (randomblob(16), randomblob(16))",
        )
        .execute(&pool)
        .await
        .expect("insert legacy process registry");

        guard_agent_runtime_schema(&pool)
            .await
            .expect("repair process registry schema");

        let column_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('agent_process_registry') WHERE name = 'updated_at'",
        )
        .fetch_one(&pool)
        .await
        .expect("read repaired schema");
        assert_eq!(column_count, 1);

        let updated_at: Option<String> =
            sqlx::query_scalar("SELECT updated_at FROM agent_process_registry")
                .fetch_one(&pool)
                .await
                .expect("read backfilled timestamp");
        assert!(updated_at.is_some());

        // The compatibility repair is idempotent.
        guard_agent_runtime_schema(&pool)
            .await
            .expect("repeat repair");
    }

    #[tokio::test]
    async fn rejects_missing_process_registry_before_runtime_startup() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        let error = guard_agent_runtime_schema(&pool)
            .await
            .expect_err("missing runtime table must fail startup");
        assert!(
            error
                .to_string()
                .contains("missing agent_process_registry table")
        );
    }

    #[tokio::test]
    async fn rejects_unsupported_process_registry_drift() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        sqlx::query(
            "CREATE TABLE agent_process_registry (
                id BLOB PRIMARY KEY,
                run_attempt_id BLOB NOT NULL UNIQUE,
                registry_status TEXT NOT NULL DEFAULT 'reserved',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("create incompatible process registry");

        let error = guard_agent_runtime_schema(&pool)
            .await
            .expect_err("unsupported schema drift must fail startup");
        assert!(error.to_string().contains("last_host_event_sequence"));
    }
}

#[derive(Clone)]
pub struct DBService {
    pub pool: Pool<Sqlite>,
}

impl DBService {
    pub async fn new() -> Result<DBService, Error> {
        let database_url = format!(
            "sqlite://{}",
            asset_dir().join("db.v2.sqlite").to_string_lossy()
        );
        let options = SqliteConnectOptions::from_str(&database_url)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);
        let pool = SqlitePool::connect_with(options).await?;
        run_migrations(&pool).await?;
        Ok(DBService { pool })
    }

    pub async fn new_migration_pool() -> Result<Pool<Sqlite>, Error> {
        let database_url = format!(
            "sqlite://{}",
            asset_dir().join("db.v2.sqlite").to_string_lossy()
        );
        let options = SqliteConnectOptions::from_str(&database_url)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete)
            .disable_statement_logging();
        SqlitePoolOptions::new()
            .max_connections(64)
            .connect_with(options)
            .await
    }

    pub async fn new_with_after_connect<F>(after_connect: F) -> Result<DBService, Error>
    where
        F: for<'a> Fn(
                &'a mut SqliteConnection,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>,
            > + Send
            + Sync
            + 'static,
    {
        let pool = Self::create_pool(Some(Arc::new(after_connect))).await?;
        Ok(DBService { pool })
    }

    async fn create_pool<F>(after_connect: Option<Arc<F>>) -> Result<Pool<Sqlite>, Error>
    where
        F: for<'a> Fn(
                &'a mut SqliteConnection,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>,
            > + Send
            + Sync
            + 'static,
    {
        let database_url = format!(
            "sqlite://{}",
            asset_dir().join("db.v2.sqlite").to_string_lossy()
        );
        let options = SqliteConnectOptions::from_str(&database_url)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);

        let pool = if let Some(hook) = after_connect {
            SqlitePoolOptions::new()
                .after_connect(move |conn, _meta| {
                    let hook = hook.clone();
                    Box::pin(async move {
                        hook(conn).await?;
                        Ok(())
                    })
                })
                .connect_with(options)
                .await?
        } else {
            SqlitePool::connect_with(options).await?
        };

        run_migrations(&pool).await?;
        Ok(pool)
    }
}
