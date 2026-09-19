//! Destructive development-only database reset. Never compiled into releases.
//!
//! The fixture is copied and validated in isolation; the currently installed
//! database is replaced only after every check succeeds. Other assets survive.
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, bail, ensure};
use serde::Deserialize;
use sha2::{Digest, Sha384};
use sqlx::{
    Connection, SqliteConnection,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
};

const DATABASE: &str = "db.v2.sqlite";
const SIDECARS: [&str; 3] = ["-wal", "-shm", "-journal"];
static MIGRATOR: Migrator = sqlx::migrate!("../db/migrations");

#[derive(Debug)]
pub(crate) struct DevelopmentDatabaseGuard {
    // Do not unlink the lock file: replacing its inode would defeat the lock.
    _file: File,
}

pub(crate) async fn reset() -> anyhow::Result<DevelopmentDatabaseGuard> {
    let seed = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../dev_assets_seed/db.v2.sqlite");
    reset_from(&seed, &utils::assets::asset_dir()).await
}

async fn reset_from(seed: &Path, assets: &Path) -> anyhow::Result<DevelopmentDatabaseGuard> {
    ensure_regular(seed)
        .context("Development snapshot missing or unsafe; run pnpm run dev:fixture")?;
    for sidecar in sidecars(seed) {
        ensure!(
            !optional_regular(&sidecar)?,
            "Development snapshot must be a standalone SQLite file, without {}",
            sidecar.display()
        );
    }
    ensure_directory(assets)?;
    let target = assets.join(DATABASE);
    if optional_regular(&target)? {
        ensure!(
            seed.canonicalize()? != target.canonicalize()?,
            "Development snapshot and destination must be different files"
        );
    }
    let lock_path = assets.join("development-database.lock");
    optional_regular(&lock_path)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)?;
    lock.try_lock().map_err(|error| {
        anyhow::anyhow!(
            "Cannot reset development database: another backend owns {}. Stop it before restarting ({error})",
            assets.display()
        )
    })?;
    let guard = DevelopmentDatabaseGuard { _file: lock };

    // Never touch the target while validating or migrating the fixture. Copying
    // bytes into a tempfile also avoids inheriting a read-only source attribute.
    let mut staged = tempfile::Builder::new()
        .prefix(".development-db-")
        .suffix(".sqlite")
        .tempfile_in(assets)?;
    io::copy(&mut File::open(seed)?, staged.as_file_mut())?;
    staged.as_file().sync_all()?;
    prepare_snapshot(staged.path(), assets)
        .await
        .context("Invalid development snapshot; previous database was not replaced")?;
    staged.as_file().sync_all()?;

    // Provider/script processes may outlive a crashed backend. Read both the
    // durable host registry and the provider registry; never kill any PID here.
    ensure_file_processes_stopped(assets)?;
    if optional_regular(&target)? {
        for sidecar in sidecars(&target) {
            optional_regular(&sidecar)?;
        }
        let mut current = connect(&target, false).await.context(
            "Cannot open current development database exclusively; stop other backends first",
        )?;
        // DELETE mode plus an exclusive transaction also rejects WAL readers
        // and flushes recoverable sidecars before replacing the main file.
        let check = async {
            sqlx::query("BEGIN EXCLUSIVE").execute(&mut current).await?;
            ensure_database_processes_stopped(&mut current).await
        }
        .await;
        // Close even on failed validation, including SQLite's worker thread.
        current.close().await?;
        check.context("Development reset refused; stop running agents/backends first")?;
    }
    // Only these exact SQLite sidecars belong to the replaced database. No
    // directory cleanup, credential reset, or workspace deletion occurs.
    for sidecar in sidecars(&target) {
        if optional_regular(&sidecar)? {
            ensure!(
                fs::metadata(&sidecar)?.len() == 0,
                "Cannot reset with a nonempty SQLite sidecar: {}",
                sidecar.display()
            );
            fs::remove_file(&sidecar)?;
        }
    }
    staged.persist(&target).map_err(|error| {
        anyhow::anyhow!(
            "Cannot replace development database {} (close SQLite tools/backends): {}",
            target.display(),
            error.error
        )
    })?;
    tracing::warn!(
        path = %target.display(),
        "Development database reset from fixture; previous database records were discarded"
    );
    Ok(guard)
}

async fn connect(path: &Path, read_only: bool) -> anyhow::Result<SqliteConnection> {
    let mut options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(read_only)
        .busy_timeout(Duration::ZERO);
    if !read_only {
        options = options.journal_mode(SqliteJournalMode::Delete);
    }
    Ok(SqliteConnection::connect_with(&options).await?)
}

async fn prepare_snapshot(path: &Path, assets: &Path) -> anyhow::Result<()> {
    let mut connection = connect(path, true).await?;
    let validation = integrity(&mut connection).await;
    connection.close().await?;
    validation?;

    let mut connection = connect(path, false).await?;
    let validation = async {
        normalize_line_endings(&mut connection).await?;
        MIGRATOR.run(&mut connection).await?;
        ensure_inactive_snapshot(&mut connection).await?;
        materialize_workspace(&mut connection, assets).await?;
        integrity(&mut connection).await
    }
    .await;
    connection.close().await?;
    validation
}

async fn integrity(connection: &mut SqliteConnection) -> anyhow::Result<()> {
    let checks: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(&mut *connection)
        .await?;
    ensure!(checks == ["ok"], "SQLite integrity check failed");
    ensure!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_optional(connection)
            .await?
            .is_none(),
        "SQLite foreign-key check failed"
    );
    Ok(())
}

async fn normalize_line_endings(connection: &mut SqliteConnection) -> anyhow::Result<()> {
    // SQLx hashes raw bytes. A committed snapshot uses LF; a Windows checkout
    // may embed CRLF migrations. Accept only a *provable* newline-only variant,
    // and change the staged copy, never the checked-in seed or user database.
    let applied: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations WHERE success = 1")
            .fetch_all(&mut *connection)
            .await?;
    for (version, checksum) in applied {
        let Some(migration) = MIGRATOR.iter().find(|item| item.version == version) else {
            bail!("Snapshot contains unknown migration {version}");
        };
        if checksum == migration.checksum.as_ref() {
            continue;
        }
        let lf = migration.sql.replace("\r\n", "\n");
        let crlf = lf.replace('\n', "\r\n");
        ensure!(
            checksum == Sha384::digest(lf.as_bytes()).as_slice()
                || checksum == Sha384::digest(crlf.as_bytes()).as_slice(),
            "Snapshot migration {version} changed beyond line endings; regenerate the seed"
        );
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(migration.checksum.as_ref())
            .bind(version)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

async fn ensure_inactive_snapshot(connection: &mut SqliteConnection) -> anyhow::Result<()> {
    for table in [
        "agent_process_registry",
        "agent_provider_sessions",
        "native_audit_streams",
        "git_connections",
        "git_import_jobs",
        "orchestration_outbox",
        "orchestration_inbox",
        "orchestration_leases",
        "agent_run_commands",
        "agent_run_launch_gates",
    ] {
        // These are compile-time identifiers, never user input.
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&mut *connection)
            .await?;
        ensure!(count == 0, "Development snapshot must not contain {table}");
    }
    for (table, predicate) in [
        (
            "agent_runs",
            "status NOT IN ('succeeded','failed','cancelled','crashed','audit_failed')",
        ),
        (
            "agent_run_attempts",
            "status NOT IN ('succeeded','failed','cancelled','crashed','audit_failed')",
        ),
        (
            "agent_run_state",
            "status NOT IN ('succeeded','failed','cancelled','crashed','audit_failed')",
        ),
        ("execution_processes", "status = 'running'"),
        (
            "workflow_runs",
            "status NOT IN ('succeeded','failed','canceled')",
        ),
        (
            "workflow_attempts",
            "status NOT IN ('succeeded','failed','canceled')",
        ),
        (
            "node_executions",
            "status NOT IN ('succeeded','failed','cancelled','skipped')",
        ),
        (
            "orchestration_runs",
            "status NOT IN ('succeeded','failed','cancelled')",
        ),
        ("scheduled_tasks", "enabled != 0"),
    ] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE {predicate}"))
                .fetch_one(&mut *connection)
                .await?;
        ensure!(count == 0, "Development snapshot contains active {table}");
    }
    Ok(())
}

async fn materialize_workspace(
    connection: &mut SqliteConnection,
    assets: &Path,
) -> anyhow::Result<()> {
    let workspace = assets.join("fixture-workspace");
    ensure_directory(&workspace)?;
    let workspace = workspace.canonicalize()?;
    let path = workspace.to_string_lossy();
    for query in [
        "UPDATE workspaces SET container_ref = ? WHERE container_ref = '@fixture-workspace@'",
        "UPDATE agent_runs SET workspace_path = ? WHERE workspace_path = '@fixture-workspace@'",
        "UPDATE agent_runs SET request_envelope = json_set(request_envelope, '$.workspace.path', ?) WHERE json_extract(request_envelope, '$.workspace.path') = '@fixture-workspace@'",
        "UPDATE agent_run_attempts SET request_envelope = json_set(request_envelope, '$.workspace.path', ?) WHERE json_extract(request_envelope, '$.workspace.path') = '@fixture-workspace@'",
    ] {
        sqlx::query(query)
            .bind(path.as_ref())
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

async fn ensure_database_processes_stopped(
    connection: &mut SqliteConnection,
) -> anyhow::Result<()> {
    if table_exists(connection, "git_import_jobs").await? {
        let writers: Vec<(i64, String)> = sqlx::query_as(
            "SELECT writer_pid, transport FROM git_import_jobs WHERE state IN ('queued','running','cancelling') AND writer_pid IS NOT NULL",
        )
        .fetch_all(&mut *connection)
        .await?;
        for (pid, transport) in writers {
            // Reuse Git's observer: native imports own a process group on Unix,
            // and the launch sentinel (-1) is unknown, not proof of exit.
            ensure!(
                crate::routes::git_import::writer_absent(pid, transport == "native"),
                "Git import writer {pid} is live or unobservable; stop the import before restarting the development backend"
            );
        }
    }
    if !table_exists(connection, "agent_process_registry").await? {
        return Ok(());
    }
    let processes: Vec<(Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT host_pid, pid FROM agent_process_registry WHERE registry_status != 'exited'",
    )
    .fetch_all(connection)
    .await?;
    for (host, provider) in processes {
        for pid in [host, provider].into_iter().flatten() {
            ensure_process_stopped(u32::try_from(pid).context("Invalid persisted process ID")?)?;
        }
    }
    Ok(())
}

async fn table_exists(connection: &mut SqliteConnection, name: &str) -> anyhow::Result<bool> {
    let exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind(name)
            .fetch_one(connection)
            .await?;
    Ok(exists != 0)
}

fn ensure_file_processes_stopped(assets: &Path) -> anyhow::Result<()> {
    #[derive(Deserialize)]
    struct Registry {
        processes: Vec<Process>,
    }
    #[derive(Deserialize)]
    struct Process {
        pid: u32,
    }
    let path = assets.join("runtime/agent-process-registry.json");
    if !optional_regular(&path)? {
        return Ok(());
    }
    let registry: Registry = serde_json::from_reader(File::open(path)?)
        .context("Cannot validate development process registry; refusing database reset")?;
    for process in registry.processes {
        ensure_process_stopped(process.pid)?;
    }
    Ok(())
}

fn ensure_process_stopped(pid: u32) -> anyhow::Result<()> {
    ensure!(pid > 0, "Invalid persisted process ID");
    ensure!(
        process_has_exited(pid).with_context(|| format!("Cannot observe process {pid}"))?,
        "Process {pid} is still alive; stop the agent/script before restarting the development backend"
    );
    Ok(())
}

#[cfg(windows)]
fn process_has_exited(pid: u32) -> io::Result<bool> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    // Query only. Access denied is unknown (an error), never evidence of exit.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
                Ok(true)
            } else {
                Err(error)
            };
        }
        let mut exit_code = 0;
        let result = if GetExitCodeProcess(handle, &mut exit_code) != 0 {
            Ok(exit_code != STILL_ACTIVE as u32)
        } else {
            Err(io::Error::last_os_error())
        };
        CloseHandle(handle);
        result
    }
}

#[cfg(unix)]
fn process_has_exited(pid: u32) -> io::Result<bool> {
    let pid = i32::try_from(pid)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "PID out of range"))?;
    // Signal zero observes existence without sending a signal.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return Ok(false);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(true)
    } else {
        Err(error)
    }
}

#[cfg(not(any(unix, windows)))]
fn process_has_exited(_pid: u32) -> io::Result<bool> {
    Err(io::Error::other("Process observation is unsupported"))
}

fn sidecars(database: &Path) -> impl Iterator<Item = PathBuf> + '_ {
    SIDECARS.into_iter().map(|suffix| {
        let mut path = database.as_os_str().to_os_string();
        path.push(suffix);
        PathBuf::from(path)
    })
}

fn ensure_regular(path: &Path) -> anyhow::Result<()> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("Cannot inspect {}", path.display()))?;
    ensure!(
        metadata.is_file() && !is_link(&metadata),
        "Expected a regular non-linked file: {}",
        path.display()
    );
    Ok(())
}

fn optional_regular(path: &Path) -> anyhow::Result<bool> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
        Ok(_) => {
            ensure_regular(path)?;
            Ok(true)
        }
    }
}

fn ensure_directory(path: &Path) -> anyhow::Result<()> {
    if !path.try_exists()? {
        fs::create_dir_all(path)?;
    }
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_dir() && !is_link(&metadata),
        "Expected a real directory, not a link: {}",
        path.display()
    );
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

#[cfg(test)]
mod tests {
    use db::models::task::Task;
    use executors::runtime::{AgentRunRequestEnvelope, RunAttemptRequest, RunState};
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;
    use uuid::Uuid;

    use super::*;

    fn fixture() -> (TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let seed = temp.path().join("seed.sqlite");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../dev_assets_seed/db.v2.sqlite"),
            &seed,
        )
        .expect("Generate the development snapshot before running startup tests");
        let assets = temp.path().join("assets");
        fs::create_dir(&assets).unwrap();
        (temp, seed, assets)
    }

    #[tokio::test]
    async fn repeated_start_restores_fixture_and_preserves_non_database_files() {
        let (_temp, seed, assets) = fixture();
        let source_bytes = fs::read(&seed).unwrap();
        fs::write(assets.join("config.json"), b"keep config").unwrap();
        let guard = reset_from(&seed, &assets).await.unwrap();
        let workspace_file = assets.join("fixture-workspace/keep.txt");
        fs::write(&workspace_file, b"keep work").unwrap();
        let target = assets.join(DATABASE);
        let mut connection = connect(&target, false).await.unwrap();
        let before: Vec<(Vec<u8>, String)> =
            sqlx::query_as("SELECT id, name FROM projects ORDER BY id")
                .fetch_all(&mut connection)
                .await
                .unwrap();
        assert!(!before.is_empty());
        sqlx::query("UPDATE projects SET name = 'Changed during development'")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE manual_test_data (id INTEGER)")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        drop(guard);

        let _guard = reset_from(&seed, &assets).await.unwrap();
        let mut connection = connect(&target, true).await.unwrap();
        let after: Vec<(Vec<u8>, String)> =
            sqlx::query_as("SELECT id, name FROM projects ORDER BY id")
                .fetch_all(&mut connection)
                .await
                .unwrap();
        assert_eq!(before, after);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'manual_test_data'"
            )
            .fetch_one(&mut connection)
            .await
            .unwrap(),
            0
        );
        integrity(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        assert_eq!(fs::read(&seed).unwrap(), source_bytes);
        assert_eq!(
            fs::read(assets.join("config.json")).unwrap(),
            b"keep config"
        );
        assert_eq!(fs::read(workspace_file).unwrap(), b"keep work");
    }

    #[tokio::test]
    async fn snapshot_roundtrips_through_real_task_and_runtime_contracts() {
        let (_temp, seed, assets) = fixture();
        let _guard = reset_from(&seed, &assets).await.unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(assets.join(DATABASE)))
            .await
            .unwrap();
        let task_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM tasks")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(task_ids.len() >= 2);
        for id in task_ids {
            assert!(Task::summary_by_id(&pool, id).await.unwrap().is_some());
        }
        let graphs: Vec<String> = sqlx::query_scalar("SELECT graph_json FROM workflows")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(!graphs.is_empty());
        for graph in graphs {
            serde_json::from_str::<workflow::graph::WorkflowGraph>(&graph).unwrap();
        }
        let envelopes: Vec<(String, String)> = sqlx::query_as(
            "SELECT run.request_envelope, attempt.request_envelope FROM agent_runs run JOIN agent_run_attempts attempt ON attempt.agent_run_id = run.id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(!envelopes.is_empty());
        for (run, attempt) in envelopes {
            let run: AgentRunRequestEnvelope = serde_json::from_str(&run).unwrap();
            let attempt: RunAttemptRequest = serde_json::from_str(&attempt).unwrap();
            attempt.validate_for_run(&run).unwrap();
            assert!(Path::new(&run.workspace.path).is_dir());
        }
        let states: Vec<String> = sqlx::query_scalar("SELECT state_json FROM agent_run_state")
            .fetch_all(&pool)
            .await
            .unwrap();
        for state in states {
            serde_json::from_str::<RunState>(&state).unwrap();
        }
        pool.close().await;
    }

    #[tokio::test]
    async fn missing_and_corrupt_snapshots_leave_previous_database_untouched() {
        let (_temp, seed, assets) = fixture();
        let target = assets.join(DATABASE);
        fs::write(&target, b"previous database sentinel").unwrap();
        let old = fs::read(&target).unwrap();
        assert!(
            reset_from(&seed.with_extension("missing"), &assets)
                .await
                .is_err()
        );
        fs::write(&seed, b"not SQLite").unwrap();
        assert!(reset_from(&seed, &assets).await.is_err());
        assert_eq!(fs::read(&target).unwrap(), old);
        assert_eq!(fs::read_dir(&assets).unwrap().count(), 2); // DB + owner lock
    }

    #[tokio::test]
    async fn invalid_migration_or_active_runtime_snapshot_never_replaces_current_database() {
        let (_temp, seed, assets) = fixture();
        let target = assets.join(DATABASE);
        fs::write(&target, b"preserve").unwrap();
        let mut connection = connect(&seed, false).await.unwrap();
        sqlx::query("UPDATE workflow_attempts SET status = 'running'")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        assert!(
            format!("{:#}", reset_from(&seed, &assets).await.unwrap_err())
                .contains("active workflow_attempts")
        );
        let mut connection = connect(&seed, false).await.unwrap();
        sqlx::query("UPDATE workflow_attempts SET status = 'succeeded'")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("UPDATE agent_runs SET status = 'running'")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        assert!(
            format!("{:#}", reset_from(&seed, &assets).await.unwrap_err())
                .contains("active agent_runs")
        );
        let mut connection = connect(&seed, false).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum = zeroblob(48)")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        assert!(
            format!("{:#}", reset_from(&seed, &assets).await.unwrap_err())
                .contains("beyond line endings")
        );
        assert_eq!(fs::read(&target).unwrap(), b"preserve");
    }

    #[tokio::test]
    async fn second_backend_is_rejected_until_first_lifetime_guard_is_dropped() {
        let (_temp, seed, assets) = fixture();
        let guard = reset_from(&seed, &assets).await.unwrap();
        let before = fs::read(assets.join(DATABASE)).unwrap();
        let error = reset_from(&seed, &assets).await.unwrap_err();
        assert!(error.to_string().contains("another backend"));
        assert_eq!(fs::read(assets.join(DATABASE)).unwrap(), before);
        drop(guard);
        reset_from(&seed, &assets).await.unwrap();
    }

    #[tokio::test]
    async fn busy_sqlite_connection_and_live_provider_prevent_reset() {
        let (_temp, seed, assets) = fixture();
        drop(reset_from(&seed, &assets).await.unwrap());
        let target = assets.join(DATABASE);
        let before = fs::read(&target).unwrap();
        let mut connection = connect(&target, false).await.unwrap();
        sqlx::query("BEGIN EXCLUSIVE")
            .execute(&mut connection)
            .await
            .unwrap();
        assert!(reset_from(&seed, &assets).await.is_err());
        connection.close().await.unwrap();
        assert_eq!(fs::read(&target).unwrap(), before);

        fs::create_dir(assets.join("runtime")).unwrap();
        fs::write(
            assets.join("runtime/agent-process-registry.json"),
            serde_json::to_vec(
                &serde_json::json!({"version": 1, "processes": [{"pid": std::process::id()}]}),
            )
            .unwrap(),
        )
        .unwrap();
        let error = reset_from(&seed, &assets).await.unwrap_err();
        assert!(format!("{error:#}").contains("still alive"));
        assert_eq!(fs::read(&target).unwrap(), before);
    }

    #[tokio::test]
    async fn foreign_key_failure_leaves_existing_data_untouched() {
        let (_temp, seed, assets) = fixture();
        let target = assets.join(DATABASE);
        fs::write(&target, b"preserve").unwrap();
        let mut connection = connect(&seed, false).await.unwrap();
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("UPDATE sessions SET workspace_id = zeroblob(16)")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let error = reset_from(&seed, &assets).await.unwrap_err();
        assert!(format!("{error:#}").contains("foreign-key"));
        assert_eq!(fs::read(&target).unwrap(), b"preserve");
    }

    #[tokio::test]
    async fn live_or_unknown_git_import_writer_prevents_reset() {
        let (_temp, seed, assets) = fixture();
        drop(reset_from(&seed, &assets).await.unwrap());
        let target = assets.join(DATABASE);
        for pid in [i64::from(std::process::id()), -1] {
            let mut connection = connect(&target, false).await.unwrap();
            sqlx::query(
                "INSERT OR REPLACE INTO git_import_jobs (id, request_id, request_json, transport, writer_pid, url, directory_path, state, phase) VALUES (?, ?, '{}', 'imported', ?, 'https://example.invalid/demo.git', 'synthetic-import', 'running', 'downloading')",
            )
            .bind(Uuid::nil())
            .bind(Uuid::nil())
            .bind(pid)
            .execute(&mut connection)
            .await
            .unwrap();
            connection.close().await.unwrap();
            let before = fs::read(&target).unwrap();
            let error = reset_from(&seed, &assets).await.unwrap_err();
            assert!(format!("{error:#}").contains("Git import writer"));
            assert_eq!(fs::read(&target).unwrap(), before);
        }
    }

    #[tokio::test]
    async fn unsafe_target_or_snapshot_sidecar_is_not_removed() {
        let (_temp, seed, assets) = fixture();
        let target = assets.join(DATABASE);
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), b"keep").unwrap();
        assert!(reset_from(&seed, &assets).await.is_err());
        assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"keep");
        let sidecar = sidecars(&seed).next().unwrap();
        fs::write(&sidecar, b"uncheckpointed seed").unwrap();
        assert!(reset_from(&seed, &assets).await.is_err());
        assert_eq!(fs::read(sidecar).unwrap(), b"uncheckpointed seed");
    }

    #[test]
    fn process_observation_is_read_only_and_distinguishes_dead_processes() {
        assert!(!process_has_exited(std::process::id()).unwrap());
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.arg("--list").stdout(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        drop(child);
        assert!(process_has_exited(pid).unwrap());
    }

    #[tokio::test]
    async fn provable_line_ending_checksum_variant_is_fixed_only_in_staged_copy() {
        let (_temp, seed, assets) = fixture();
        let migration = MIGRATOR.iter().next().unwrap();
        let crlf = migration.sql.replace("\r\n", "\n").replace('\n', "\r\n");
        let mut connection = connect(&seed, false).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(Sha384::digest(crlf.as_bytes()).to_vec())
            .bind(migration.version)
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let before = fs::read(&seed).unwrap();
        let _guard = reset_from(&seed, &assets).await.unwrap();
        assert_eq!(before, fs::read(&seed).unwrap());
        let mut connection = connect(&assets.join(DATABASE), true).await.unwrap();
        let checksum: Vec<u8> =
            sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = ?")
                .bind(migration.version)
                .fetch_one(&mut connection)
                .await
                .unwrap();
        assert_eq!(checksum, migration.checksum.as_ref());
        connection.close().await.unwrap();
    }
}
