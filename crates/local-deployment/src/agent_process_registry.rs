use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

const REGISTRY_VERSION: u32 = 1;
const REGISTRY_FILE_NAME: &str = "agent-process-registry.json";
const TERMINATION_GRACE_PERIOD: Duration = Duration::from_secs(2);
const OS_PROCESS_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct RegisteredAgentProcess {
    /// Identity of the supervised runtime attempt. This is an AgentRun
    /// attempt ID for canonical agents and a standalone process ID for
    /// script execution; the registry never translates between the two.
    pub runtime_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub pid: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_group_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_preview: Option<String>,
    pub registered_at_ms: u64,
}

impl RegisteredAgentProcess {
    pub(crate) fn new(
        runtime_id: Uuid,
        session_id: Option<Uuid>,
        workspace_id: Option<Uuid>,
        provider: Option<String>,
        pid: u32,
        process_group_id: Option<u32>,
        command_preview: Option<String>,
    ) -> Self {
        Self {
            runtime_id,
            session_id,
            workspace_id,
            provider,
            pid,
            process_group_id,
            command_preview,
            registered_at_ms: unix_time_ms_now(),
        }
    }

    fn is_valid(&self) -> bool {
        self.pid > 0
            && self.registered_at_ms > 0
            && self
                .process_group_id
                .is_none_or(|process_group_id| process_group_id > 0)
    }
}

#[derive(Debug, Clone, Serialize)]
struct AgentProcessRegistryFile {
    version: u32,
    processes: Vec<RegisteredAgentProcess>,
}

#[derive(Debug, Default)]
struct LoadedRegistry {
    processes: Vec<RegisteredAgentProcess>,
    needs_rewrite: bool,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AgentProcessCleanupReport {
    pub attempted: usize,
    pub removed: usize,
    pub survivors: usize,
}

/// The observation returned by restart reconciliation.  Reconciliation is
/// deliberately read-only: an entry is never killed or removed merely because
/// the supervisor that created it is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RegisteredProcessPresence {
    Alive,
    Exited,
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RegisteredProcessObservation {
    pub process: RegisteredAgentProcess,
    pub presence: RegisteredProcessPresence,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct AgentProcessReconciliationReport {
    pub observations: Vec<RegisteredProcessObservation>,
}

impl AgentProcessReconciliationReport {
    pub(crate) fn alive(&self) -> impl Iterator<Item = &RegisteredProcessObservation> {
        self.observations
            .iter()
            .filter(|observation| observation.presence == RegisteredProcessPresence::Alive)
    }

    pub(crate) fn exited(&self) -> impl Iterator<Item = &RegisteredProcessObservation> {
        self.observations
            .iter()
            .filter(|observation| observation.presence == RegisteredProcessPresence::Exited)
    }
}

impl AgentProcessCleanupReport {
    pub(crate) fn is_empty(self) -> bool {
        self.attempted == 0 && self.removed == 0 && self.survivors == 0
    }

    pub(crate) fn confirms_runtime_absent(self) -> bool {
        self.attempted > 0 && self.removed == self.attempted && self.survivors == 0
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AgentProcessRegistry {
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl AgentProcessRegistry {
    pub(crate) fn default() -> Self {
        Self::new(default_registry_path())
    }

    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) async fn register(&self, process: RegisteredAgentProcess) -> io::Result<()> {
        if !process.is_valid() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "agent process registry entry is missing required process metadata",
            ));
        }

        let _guard = self.lock.lock().await;
        let mut registry = self.load_registry_locked().await?;
        registry
            .processes
            .retain(|entry| entry.runtime_id != process.runtime_id);
        registry.processes.push(process);
        self.write_registry_locked(&registry.processes).await
    }

    pub(crate) async fn remove_runtime(&self, runtime_id: Uuid) -> io::Result<bool> {
        let _guard = self.lock.lock().await;
        let mut registry = self.load_registry_locked().await?;
        let before = registry.processes.len();
        registry
            .processes
            .retain(|entry| entry.runtime_id != runtime_id);
        let removed = before != registry.processes.len();

        if removed || registry.needs_rewrite {
            self.write_registry_locked(&registry.processes).await?;
        }

        Ok(removed)
    }

    /// Return the entries currently persisted in the registry. Invalid and
    /// duplicate entries are dropped when the next mutation occurs, while a
    /// read remains best-effort and never terminates a process.
    pub(crate) async fn entries(&self) -> io::Result<Vec<RegisteredAgentProcess>> {
        let _guard = self.lock.lock().await;
        let registry = self.load_registry_locked().await?;
        if registry.needs_rewrite {
            self.write_registry_locked(&registry.processes).await?;
        }
        Ok(registry.processes)
    }

    pub(crate) async fn query_runtime(
        &self,
        runtime_id: Uuid,
    ) -> io::Result<Option<RegisteredAgentProcess>> {
        Ok(self
            .entries()
            .await?
            .into_iter()
            .find(|entry| entry.runtime_id == runtime_id))
    }

    /// Observe all persisted processes after a service restart. This operation
    /// intentionally has no cleanup side effects. Callers may attach a live
    /// process to a watcher, observe an exited process, or leave an
    /// temporarily unreachable process for a later reconciliation pass.
    pub(crate) async fn reconcile(&self) -> io::Result<AgentProcessReconciliationReport> {
        let entries = self.entries().await?;
        let mut observations = Vec::with_capacity(entries.len());
        for process in entries {
            let presence = match observe_os_process(&process).await {
                Ok(presence) => presence,
                Err(error) => {
                    tracing::warn!(
                        runtime_id = %process.runtime_id,
                        pid = process.pid,
                        error = %error,
                        "unable to observe registered agent process; preserving registry entry"
                    );
                    RegisteredProcessPresence::Unreachable
                }
            };
            observations.push(RegisteredProcessObservation { process, presence });
        }
        Ok(AgentProcessReconciliationReport { observations })
    }

    pub(crate) async fn cleanup_runtime(
        &self,
        runtime_id: Uuid,
    ) -> io::Result<AgentProcessCleanupReport> {
        self.cleanup_matching(|entry| entry.runtime_id == runtime_id, &OsProcessTerminator)
            .await
    }

    async fn cleanup_matching<T, F>(
        &self,
        predicate: F,
        terminator: &T,
    ) -> io::Result<AgentProcessCleanupReport>
    where
        T: ProcessTerminator + Sync,
        F: Fn(&RegisteredAgentProcess) -> bool,
    {
        let _guard = self.lock.lock().await;
        let registry = self.load_registry_locked().await?;
        let mut survivors = Vec::with_capacity(registry.processes.len());
        let mut report = AgentProcessCleanupReport::default();

        for process in registry.processes {
            if !predicate(&process) {
                survivors.push(process);
                continue;
            }

            report.attempted += 1;
            match terminator.terminate(&process).await {
                Ok(ProcessTermination::Terminated) => {
                    report.removed += 1;
                    tracing::info!(
                        runtime_id = %process.runtime_id,
                        session_id = ?process.session_id,
                        workspace_id = ?process.workspace_id,
                        provider = ?process.provider,
                        pid = process.pid,
                        process_group_id = ?process.process_group_id,
                        "cleaned registered agent process tree"
                    );
                }
                Ok(ProcessTermination::Missing) => {
                    report.removed += 1;
                    tracing::debug!(
                        runtime_id = %process.runtime_id,
                        pid = process.pid,
                        process_group_id = ?process.process_group_id,
                        "registered agent process was already gone"
                    );
                }
                Err(error) => {
                    report.survivors += 1;
                    tracing::warn!(
                        runtime_id = %process.runtime_id,
                        session_id = ?process.session_id,
                        workspace_id = ?process.workspace_id,
                        provider = ?process.provider,
                        pid = process.pid,
                        process_group_id = ?process.process_group_id,
                        error = %error,
                        "failed to clean registered agent process tree"
                    );
                    survivors.push(process);
                }
            }
        }

        if report.attempted > 0 || registry.needs_rewrite {
            self.write_registry_locked(&survivors).await?;
        }

        Ok(report)
    }

    async fn load_registry_locked(&self) -> io::Result<LoadedRegistry> {
        let bytes = match tokio::fs::read(self.path.as_ref()).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(LoadedRegistry::default());
            }
            Err(error) => return Err(error),
        };

        if bytes.iter().all(u8::is_ascii_whitespace) {
            tracing::warn!(
                path = %self.path.display(),
                "agent process registry file is empty; treating as empty"
            );
            return Ok(LoadedRegistry {
                processes: Vec::new(),
                needs_rewrite: true,
            });
        }

        let value = match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(
                    path = %self.path.display(),
                    error = %error,
                    "agent process registry file is corrupt; treating as empty"
                );
                return Ok(LoadedRegistry {
                    processes: Vec::new(),
                    needs_rewrite: true,
                });
            }
        };

        let version = value.get("version").and_then(serde_json::Value::as_u64);
        let process_values = match value.get("processes").and_then(serde_json::Value::as_array) {
            Some(process_values) => process_values,
            None => {
                tracing::warn!(
                    path = %self.path.display(),
                    "agent process registry file has no process array; treating as empty"
                );
                return Ok(LoadedRegistry {
                    processes: Vec::new(),
                    needs_rewrite: true,
                });
            }
        };

        let mut needs_rewrite = version != Some(u64::from(REGISTRY_VERSION));
        let mut by_execution_id = HashMap::new();

        for process_value in process_values {
            match serde_json::from_value::<RegisteredAgentProcess>(process_value.clone()) {
                Ok(process) if process.is_valid() => {
                    if by_execution_id
                        .insert(process.runtime_id, process)
                        .is_some()
                    {
                        needs_rewrite = true;
                    }
                }
                Ok(process) => {
                    needs_rewrite = true;
                    tracing::warn!(
                        runtime_id = %process.runtime_id,
                        pid = process.pid,
                        process_group_id = ?process.process_group_id,
                        registered_at_ms = process.registered_at_ms,
                        "dropping invalid agent process registry entry"
                    );
                }
                Err(error) => {
                    needs_rewrite = true;
                    tracing::warn!(
                        path = %self.path.display(),
                        error = %error,
                        "dropping unreadable agent process registry entry"
                    );
                }
            }
        }

        let mut processes: Vec<_> = by_execution_id.into_values().collect();
        sort_processes(&mut processes);

        Ok(LoadedRegistry {
            processes,
            needs_rewrite,
        })
    }

    async fn write_registry_locked(&self, processes: &[RegisteredAgentProcess]) -> io::Result<()> {
        let parent = self.path.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "agent process registry path has no parent directory",
            )
        })?;

        tokio::fs::create_dir_all(parent).await?;

        let mut processes = processes.to_vec();
        sort_processes(&mut processes);

        let file = AgentProcessRegistryFile {
            version: REGISTRY_VERSION,
            processes,
        };
        let bytes = serde_json::to_vec_pretty(&file)
            .map_err(|error| io::Error::other(format!("serialize registry: {error}")))?;
        let temp_path = temp_registry_path(self.path.as_ref());

        tokio::fs::write(&temp_path, bytes).await?;
        replace_file(&temp_path, self.path.as_ref()).await
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessTermination {
    Terminated,
    Missing,
}

#[async_trait]
trait ProcessTerminator {
    async fn terminate(&self, process: &RegisteredAgentProcess) -> io::Result<ProcessTermination>;
}

struct OsProcessTerminator;

#[async_trait]
impl ProcessTerminator for OsProcessTerminator {
    async fn terminate(&self, process: &RegisteredAgentProcess) -> io::Result<ProcessTermination> {
        terminate_os_process_tree(process).await
    }
}

#[cfg(unix)]
async fn terminate_os_process_tree(
    process: &RegisteredAgentProcess,
) -> io::Result<ProcessTermination> {
    use nix::sys::signal::Signal;

    if matches!(
        send_unix_signal(process, Some(Signal::SIGTERM)).await?,
        SignalDelivery::Missing
    ) {
        return Ok(ProcessTermination::Missing);
    }

    tokio::time::sleep(TERMINATION_GRACE_PERIOD).await;

    if matches!(
        send_unix_signal(process, None).await?,
        SignalDelivery::Missing
    ) {
        return Ok(ProcessTermination::Terminated);
    }

    if matches!(
        send_unix_signal(process, Some(Signal::SIGKILL)).await?,
        SignalDelivery::Missing
    ) {
        return Ok(ProcessTermination::Terminated);
    }

    tokio::time::sleep(Duration::from_millis(250)).await;

    match send_unix_signal(process, None).await? {
        SignalDelivery::Missing => Ok(ProcessTermination::Terminated),
        SignalDelivery::Sent => Err(io::Error::other(
            "process tree survived SIGTERM and SIGKILL",
        )),
    }
}

#[cfg(windows)]
async fn terminate_os_process_tree(
    process: &RegisteredAgentProcess,
) -> io::Result<ProcessTermination> {
    if matches!(
        run_taskkill(process.pid, false).await?,
        SignalDelivery::Missing
    ) {
        return Ok(ProcessTermination::Missing);
    }

    tokio::time::sleep(TERMINATION_GRACE_PERIOD).await;

    match run_taskkill(process.pid, true).await? {
        SignalDelivery::Missing => Ok(ProcessTermination::Terminated),
        SignalDelivery::Sent => wait_for_windows_pid_exit(process.pid).await,
    }
}

#[cfg(not(any(unix, windows)))]
async fn terminate_os_process_tree(
    _process: &RegisteredAgentProcess,
) -> io::Result<ProcessTermination> {
    Err(io::Error::other(
        "registered process cleanup is unsupported on this platform",
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignalDelivery {
    Sent,
    Missing,
}

#[cfg(unix)]
async fn send_unix_signal(
    process: &RegisteredAgentProcess,
    signal: Option<nix::sys::signal::Signal>,
) -> io::Result<SignalDelivery> {
    use nix::{errno::Errno, sys::signal, unistd::Pid};

    let raw_target = process
        .process_group_id
        .filter(|process_group_id| *process_group_id > 1)
        .unwrap_or(process.pid);
    let raw_target = i32::try_from(raw_target)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid is too large"))?;
    let target = if process
        .process_group_id
        .is_some_and(|process_group_id| process_group_id > 1)
    {
        Pid::from_raw(-raw_target)
    } else {
        Pid::from_raw(raw_target)
    };

    tokio::task::spawn_blocking(move || match signal::kill(target, signal) {
        Ok(()) => Ok(SignalDelivery::Sent),
        Err(Errno::ESRCH) => Ok(SignalDelivery::Missing),
        Err(error) => Err(io::Error::from_raw_os_error(error as i32)),
    })
    .await
    .map_err(|error| io::Error::other(format!("signal task failed: {error}")))?
}

#[cfg(windows)]
async fn run_taskkill(pid: u32, force: bool) -> io::Result<SignalDelivery> {
    let mut command = tokio::process::Command::new("taskkill");
    command.arg("/PID").arg(pid.to_string()).arg("/T");
    if force {
        command.arg("/F");
    }

    let output = tokio::time::timeout(OS_PROCESS_COMMAND_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                format!("taskkill timed out for pid {pid}"),
            )
        })??;
    if output.status.success() {
        return Ok(SignalDelivery::Sent);
    }

    if observe_windows_pid(pid).await? == RegisteredProcessPresence::Exited {
        return Ok(SignalDelivery::Missing);
    }

    Err(io::Error::other(format!(
        "taskkill failed for pid {pid}: status={:?}, stdout={}, stderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )))
}

async fn replace_file(temp_path: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        if destination.exists() {
            tokio::fs::remove_file(destination).await?;
        }
        tokio::fs::rename(temp_path, destination).await
    }

    #[cfg(not(windows))]
    {
        tokio::fs::rename(temp_path, destination).await
    }
}

#[cfg(unix)]
async fn observe_os_process(
    process: &RegisteredAgentProcess,
) -> io::Result<RegisteredProcessPresence> {
    use nix::{errno::Errno, sys::signal, unistd::Pid};

    let raw_target = process
        .process_group_id
        .filter(|group| *group > 1)
        .unwrap_or(process.pid);
    let raw_target = i32::try_from(raw_target)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid is too large"))?;
    let grouped = process.process_group_id.is_some_and(|group| group > 1);
    let target = if grouped {
        Pid::from_raw(-raw_target)
    } else {
        Pid::from_raw(raw_target)
    };

    let pid = i32::try_from(process.pid)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid is too large"))?;
    tokio::task::spawn_blocking(move || match signal::kill(target, None) {
        Ok(()) => Ok(RegisteredProcessPresence::Alive),
        Err(Errno::ESRCH) if grouped => match signal::kill(Pid::from_raw(pid), None) {
            Ok(()) => Ok(RegisteredProcessPresence::Alive),
            Err(Errno::ESRCH) => Ok(RegisteredProcessPresence::Exited),
            Err(Errno::EPERM) => Ok(RegisteredProcessPresence::Unreachable),
            Err(error) => Err(io::Error::from_raw_os_error(error as i32)),
        },
        Err(Errno::ESRCH) => Ok(RegisteredProcessPresence::Exited),
        Err(Errno::EPERM) => Ok(RegisteredProcessPresence::Unreachable),
        Err(error) => Err(io::Error::from_raw_os_error(error as i32)),
    })
    .await
    .map_err(|error| io::Error::other(format!("process observation task failed: {error}")))?
}

#[cfg(windows)]
async fn observe_os_process(
    process: &RegisteredAgentProcess,
) -> io::Result<RegisteredProcessPresence> {
    observe_windows_pid(process.pid).await
}

#[cfg(windows)]
async fn observe_windows_pid(pid: u32) -> io::Result<RegisteredProcessPresence> {
    let output = tokio::time::timeout(
        OS_PROCESS_COMMAND_TIMEOUT,
        tokio::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output(),
    )
    .await
    .map_err(|_| {
        io::Error::new(
            io::ErrorKind::TimedOut,
            format!("tasklist timed out for pid {pid}"),
        )
    })??;
    if output.status.success() {
        if tasklist_reports_pid(&output.stdout, pid) {
            Ok(RegisteredProcessPresence::Alive)
        } else {
            Ok(RegisteredProcessPresence::Exited)
        }
    } else {
        Ok(RegisteredProcessPresence::Unreachable)
    }
}

#[cfg(windows)]
async fn wait_for_windows_pid_exit(pid: u32) -> io::Result<ProcessTermination> {
    tokio::time::timeout(TERMINATION_GRACE_PERIOD, async {
        loop {
            match observe_windows_pid(pid).await? {
                RegisteredProcessPresence::Exited => return Ok(ProcessTermination::Terminated),
                RegisteredProcessPresence::Alive => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                RegisteredProcessPresence::Unreachable => {
                    return Err(io::Error::other(
                        "process tree could not be observed after forced taskkill",
                    ));
                }
            }
        }
    })
    .await
    .map_err(|_| {
        io::Error::new(
            io::ErrorKind::TimedOut,
            "process tree survived graceful and forced taskkill",
        )
    })?
}

#[cfg(windows)]
fn tasklist_reports_pid(output: &[u8], pid: u32) -> bool {
    let expected = pid.to_string();
    String::from_utf8_lossy(output).lines().any(|line| {
        line.strip_prefix('"')
            .and_then(|line| line.split("\",\"").nth(1))
            .is_some_and(|value| value == expected)
    })
}

#[cfg(not(any(unix, windows)))]
async fn observe_os_process(
    _process: &RegisteredAgentProcess,
) -> io::Result<RegisteredProcessPresence> {
    Ok(RegisteredProcessPresence::Unreachable)
}

fn default_registry_path() -> PathBuf {
    utils::assets::asset_dir()
        .join("runtime")
        .join(REGISTRY_FILE_NAME)
}

fn temp_registry_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| format!("{}.tmp", name.to_string_lossy()))
        .unwrap_or_else(|| format!("{REGISTRY_FILE_NAME}.tmp"));
    path.with_file_name(file_name)
}

fn sort_processes(processes: &mut [RegisteredAgentProcess]) {
    processes.sort_by_key(|process| (process.registered_at_ms, process.runtime_id.to_string()));
}

fn unix_time_ms_now() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        sync::{Arc, Mutex as StdMutex},
    };

    use tempfile::TempDir;

    use super::*;

    fn sample_process(pid: u32) -> RegisteredAgentProcess {
        RegisteredAgentProcess {
            runtime_id: Uuid::new_v4(),
            session_id: Some(Uuid::new_v4()),
            workspace_id: Some(Uuid::new_v4()),
            provider: Some("CODEX".to_string()),
            pid,
            process_group_id: Some(pid),
            command_preview: None,
            registered_at_ms: u64::from(pid),
        }
    }

    fn registry_in_temp_dir(temp_dir: &TempDir) -> AgentProcessRegistry {
        AgentProcessRegistry::new(temp_dir.path().join("runtime").join(REGISTRY_FILE_NAME))
    }

    #[tokio::test]
    async fn register_and_remove_preserves_unrelated_entries() {
        let temp_dir = TempDir::new().expect("temp dir");
        let registry = registry_in_temp_dir(&temp_dir);
        let first = sample_process(1001);
        let second = sample_process(1002);

        registry
            .register(first.clone())
            .await
            .expect("register first");
        registry
            .register(second.clone())
            .await
            .expect("register second");

        assert!(
            registry
                .remove_runtime(first.runtime_id)
                .await
                .expect("remove first")
        );

        let loaded = registry
            .load_registry_locked()
            .await
            .expect("load registry");
        assert_eq!(loaded.processes, vec![second]);
        assert!(
            !registry
                .remove_runtime(first.runtime_id)
                .await
                .expect("remove already removed")
        );
    }

    #[tokio::test]
    async fn reconcile_is_observational_and_preserves_unreachable_entries() {
        let temp_dir = TempDir::new().expect("temp dir");
        let registry = registry_in_temp_dir(&temp_dir);
        let process = sample_process(u32::MAX);
        registry.register(process.clone()).await.expect("register");

        let report = registry.reconcile().await.expect("reconcile");
        assert_eq!(report.observations.len(), 1);
        assert!(matches!(
            report.observations[0].presence,
            RegisteredProcessPresence::Exited | RegisteredProcessPresence::Unreachable
        ));
        assert_eq!(
            registry
                .query_runtime(process.runtime_id)
                .await
                .expect("query"),
            Some(process)
        );
    }

    #[tokio::test]
    async fn load_drops_invalid_entries_and_rewrites_on_next_mutation() {
        let temp_dir = TempDir::new().expect("temp dir");
        let registry = registry_in_temp_dir(&temp_dir);
        let valid = sample_process(2001);
        let invalid_pid = serde_json::json!({
            "runtime_id": Uuid::new_v4(),
            "pid": 0,
            "registered_at_ms": 1
        });
        let unreadable = serde_json::json!({
            "runtime_id": "not-a-uuid",
            "pid": 2002,
            "registered_at_ms": 1
        });

        let path = registry.path.as_ref();
        tokio::fs::create_dir_all(path.parent().expect("parent"))
            .await
            .expect("create parent");
        tokio::fs::write(
            path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "processes": [
                    serde_json::to_value(&valid).expect("valid json"),
                    invalid_pid,
                    unreadable
                ]
            }))
            .expect("registry json"),
        )
        .await
        .expect("write registry");

        let loaded = registry
            .load_registry_locked()
            .await
            .expect("load registry");
        assert_eq!(loaded.processes, vec![valid.clone()]);
        assert!(loaded.needs_rewrite);

        assert!(
            !registry
                .remove_runtime(Uuid::new_v4())
                .await
                .expect("rewrite registry")
        );

        let rewritten = registry
            .load_registry_locked()
            .await
            .expect("load rewritten");
        assert_eq!(rewritten.processes, vec![valid]);
        assert!(!rewritten.needs_rewrite);
    }

    #[derive(Default)]
    struct FakeTerminator {
        failures: HashSet<Uuid>,
        calls: Arc<StdMutex<Vec<Uuid>>>,
    }

    #[async_trait]
    impl ProcessTerminator for FakeTerminator {
        async fn terminate(
            &self,
            process: &RegisteredAgentProcess,
        ) -> io::Result<ProcessTermination> {
            self.calls
                .lock()
                .expect("calls lock")
                .push(process.runtime_id);

            if self.failures.contains(&process.runtime_id) {
                Err(io::Error::other("still alive"))
            } else {
                Ok(ProcessTermination::Terminated)
            }
        }
    }

    #[tokio::test]
    async fn cleanup_rewrites_registry_with_only_survivors() {
        let temp_dir = TempDir::new().expect("temp dir");
        let registry = registry_in_temp_dir(&temp_dir);
        let cleaned = sample_process(3001);
        let survivor = sample_process(3002);
        registry
            .register(cleaned.clone())
            .await
            .expect("register cleaned");
        registry
            .register(survivor.clone())
            .await
            .expect("register survivor");

        let terminator = FakeTerminator {
            failures: HashSet::from([survivor.runtime_id]),
            calls: Arc::new(StdMutex::new(Vec::new())),
        };

        let report = registry
            .cleanup_matching(|_| true, &terminator)
            .await
            .expect("cleanup");

        assert_eq!(
            report,
            AgentProcessCleanupReport {
                attempted: 2,
                removed: 1,
                survivors: 1
            }
        );
        let loaded = registry
            .load_registry_locked()
            .await
            .expect("load registry");
        assert_eq!(loaded.processes, vec![survivor]);
    }

    #[tokio::test]
    async fn cleanup_runtime_only_targets_matching_runtime_id() {
        let temp_dir = TempDir::new().expect("temp dir");
        let registry = registry_in_temp_dir(&temp_dir);
        let target = sample_process(4001);
        let untouched = sample_process(4002);
        registry
            .register(target.clone())
            .await
            .expect("register target");
        registry
            .register(untouched.clone())
            .await
            .expect("register untouched");

        let terminator = FakeTerminator::default();
        let report = registry
            .cleanup_matching(|entry| entry.runtime_id == target.runtime_id, &terminator)
            .await
            .expect("cleanup target");

        assert_eq!(report.attempted, 1);
        assert_eq!(report.removed, 1);
        let loaded = registry
            .load_registry_locked()
            .await
            .expect("load registry");
        assert_eq!(loaded.processes, vec![untouched]);
    }

    #[test]
    fn cleanup_report_only_confirms_absence_after_owned_process_removal() {
        assert!(
            AgentProcessCleanupReport {
                attempted: 1,
                removed: 1,
                survivors: 0,
            }
            .confirms_runtime_absent()
        );
        assert!(!AgentProcessCleanupReport::default().confirms_runtime_absent());
        assert!(
            !AgentProcessCleanupReport {
                attempted: 1,
                removed: 0,
                survivors: 1,
            }
            .confirms_runtime_absent()
        );
    }

    #[cfg(windows)]
    #[test]
    fn tasklist_pid_detection_does_not_depend_on_localized_missing_text() {
        let present = br#""agent.exe","4242","Console","1","10,000 K""#;
        let present_with_comma = br#""agent,worker.exe","4242","Console","1","10,000 K""#;
        assert!(tasklist_reports_pid(present, 4242));
        assert!(tasklist_reports_pid(present_with_comma, 4242));
        assert!(!tasklist_reports_pid(present, 42));
        assert!(!tasklist_reports_pid(
            "INFO: No tasks are running which match the specified criteria.".as_bytes(),
            4242
        ));
        assert!(!tasklist_reports_pid(
            &[
                0xe4, 0xbf, 0xa1, 0xe6, 0x81, 0xaf, b':', b' ', 0xe6, 0x97, 0xa0
            ],
            4242
        ));
    }
}
