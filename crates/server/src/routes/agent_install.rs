//! Small, host-local installer: only server-owned commands may be launched.
use std::{
    collections::VecDeque,
    process::Stdio,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::Path,
    routing::{get, post},
};
use command_group::AsyncCommandGroup;
use executors::executors::BaseCodingAgent;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const LOG_LIMIT: usize = 64 * 1024;
const RETAIN_COMPLETED: usize = 16;
const RETENTION: Duration = Duration::from_secs(60 * 60);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentInstallRequest {
    pub executor: BaseCodingAgent,
    pub npm_registry: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentInstallJob {
    pub id: Uuid,
    pub executor: BaseCodingAgent,
    pub status: InstallStatus,
    pub logs: String,
    pub error: Option<String>,
}

struct Job {
    view: AgentInstallJob,
    completed: Option<Instant>,
}
type JobRef = Arc<Mutex<Job>>;
static JOBS: OnceLock<Mutex<VecDeque<JobRef>>> = OnceLock::new();

// command-group's kill_on_drop covers Windows jobs, but on Unix Tokio only
// kills the shell leader. Also kill its process group when a task is dropped.
struct InstallerChild {
    child: command_group::AsyncGroupChild,
    armed: bool,
}

impl Drop for InstallerChild {
    fn drop(&mut self) {
        if self.armed {
            let _ = self.child.start_kill();
        }
    }
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/agents/install", post(start_install))
        .route("/agents/install/{job_id}", get(get_install))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // No user code executes under these locks; preserve polling after a panic.
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn prune(jobs: &mut VecDeque<JobRef>) {
    jobs.retain(|job| {
        lock(job)
            .completed
            .is_none_or(|at| at.elapsed() < RETENTION)
    });
    let mut completed = jobs
        .iter()
        .filter(|job| lock(job).completed.is_some())
        .count();
    jobs.retain(|job| {
        if completed > RETAIN_COMPLETED && lock(job).completed.is_some() {
            completed -= 1;
            false
        } else {
            true
        }
    });
}

fn validate_registry(registry: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(value) = registry.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let invalid = || {
        ApiError::BadRequest(
            "npm registry must be an HTTP(S) URL without credentials, query or fragment".into(),
        )
    };
    if value.len() > 2048 || value.chars().any(char::is_control) {
        return Err(invalid());
    }
    let url = url::Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(Some(url.to_string()))
}

fn install_command(request: &AgentInstallRequest) -> Result<Command, ApiError> {
    let registry = validate_registry(request.npm_registry.as_deref())?;
    let package = match request.executor {
        BaseCodingAgent::Codex => Some("@openai/codex"),
        BaseCodingAgent::Gemini => Some("@google/gemini-cli"),
        BaseCodingAgent::ClaudeCode | BaseCodingAgent::OhMyPi => None,
        #[cfg(feature = "qa-mode")]
        BaseCodingAgent::QaMock => {
            return Err(ApiError::BadRequest(
                "This agent does not support installation".into(),
            ));
        }
    };
    let mut command = if let Some(package) = package {
        #[cfg(windows)]
        let mut command = {
            // npm.cmd needs a command interpreter. Every shell argument here is
            // a literal whitelist value; registry input is passed only via env.
            let mut command = Command::new("cmd.exe");
            command.args(["/d", "/s", "/c", "npm", "install", "-g", package]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("npm");
            command.args(["install", "-g", package]);
            command
        };
        if let Some(registry) = registry {
            command.env("npm_config_registry", registry);
        }
        command
    } else {
        if registry.is_some() {
            return Err(ApiError::BadRequest(
                "npm registry is only supported for Codex and Gemini".into(),
            ));
        }
        #[cfg(windows)]
        let command = {
            let script = match request.executor {
                BaseCodingAgent::ClaudeCode => {
                    "$ErrorActionPreference='Stop'; try { irm https://claude.ai/install.ps1 | iex; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { Write-Error $_; exit 1 }"
                }
                BaseCodingAgent::OhMyPi => {
                    "$ErrorActionPreference='Stop'; try { irm https://omp.sh/install.ps1 | iex; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { Write-Error $_; exit 1 }"
                }
                _ => unreachable!(),
            };
            let mut command = Command::new("powershell.exe");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ]);
            command
        };
        #[cfg(not(windows))]
        let command = {
            let script = match request.executor {
                BaseCodingAgent::ClaudeCode => "curl -fsSL https://claude.ai/install.sh | bash",
                BaseCodingAgent::OhMyPi => "curl -fsSL https://omp.sh/install | sh",
                _ => unreachable!(),
            };
            let mut command = Command::new("bash");
            command.args(["-o", "pipefail", "-c", script]);
            command
        };
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(command)
}

async fn start_install(
    Json(request): Json<AgentInstallRequest>,
) -> Result<Json<ApiResponse<AgentInstallJob>>, ApiError> {
    let command = install_command(&request)?;
    let mut jobs = lock(JOBS.get_or_init(Default::default));
    prune(&mut jobs);
    for job in jobs.iter() {
        let job = lock(job);
        if job.view.executor == request.executor && job.view.status == InstallStatus::Running {
            return Ok(Json(ApiResponse::success(job.view.clone())));
        }
    }
    let view = AgentInstallJob {
        id: Uuid::new_v4(),
        executor: request.executor,
        status: InstallStatus::Running,
        logs: String::new(),
        error: None,
    };
    let job = Arc::new(Mutex::new(Job {
        view: view.clone(),
        completed: None,
    }));
    jobs.push_back(job.clone());
    tokio::spawn(run_install(job, command, INSTALL_TIMEOUT));
    Ok(Json(ApiResponse::success(view)))
}

async fn get_install(Path(id): Path<Uuid>) -> Result<Json<ApiResponse<AgentInstallJob>>, ApiError> {
    let mut jobs = lock(JOBS.get_or_init(Default::default));
    prune(&mut jobs);
    let view = jobs
        .iter()
        .find_map(|job| {
            let job = lock(job);
            (job.view.id == id).then(|| job.view.clone())
        })
        .ok_or_else(|| {
            ApiError::BadRequest("Installation job expired or was not found on this host".into())
        })?;
    Ok(Json(ApiResponse::success(view)))
}

fn append_log(job: &JobRef, bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes);
    let mut job = lock(job);
    job.view.logs.push_str(&text);
    if job.view.logs.len() > LOG_LIMIT {
        let mut start = job.view.logs.len() - LOG_LIMIT;
        while !job.view.logs.is_char_boundary(start) {
            start += 1;
        }
        job.view.logs.drain(..start);
    }
}

async fn read_logs(reader: Option<impl AsyncRead + Unpin>, job: &JobRef) -> std::io::Result<()> {
    let Some(mut reader) = reader else {
        return Ok(());
    };
    // Fixed-size reads also bound output without newlines or with invalid UTF-8.
    let mut buffer = [0u8; 4096];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(());
        }
        append_log(job, &buffer[..count]);
    }
}

async fn run_install(job: JobRef, mut command: Command, timeout: Duration) {
    let result = async {
        let mut group = command.group();
        group.kill_on_drop(true);
        #[cfg(windows)]
        group.creation_flags(0x08000000);
        let child = group.spawn().map_err(|error| format!("Could not start installer: {error}. Check npm/Node.js or the required shell is installed."))?;
        let mut guard = InstallerChild { child, armed: true };
        let child = &mut guard.child;
        let stdout = child.inner().stdout.take();
        let stderr = child.inner().stderr.take();
        let result = tokio::time::timeout(timeout, async {
            tokio::try_join!(child.wait(), read_logs(stdout, &job), read_logs(stderr, &job))
        }).await;
        match result {
            Ok(Ok((status, (), ()))) => {
                guard.armed = false;
                if status.success() { Ok(()) } else { Err(format!("Installer exited with {status}. Check the logs, network/proxy and installation permissions.")) }
            },
            other => {
                let cleanup = utils::process::kill_process_group(child).await;
                if let Err(error) = cleanup { tracing::warn!(%error, "Installer process cleanup failed"); } else { guard.armed = false; }
                match other {
                    Err(_) => Err("Installation timed out after 15 minutes".into()),
                    Ok(Err(error)) => Err(format!("Could not monitor installer: {error}")),
                    _ => unreachable!(),
                }
            }
        }
    }.await;
    let mut job = lock(&job);
    job.view.status = if result.is_ok() {
        InstallStatus::Succeeded
    } else {
        InstallStatus::Failed
    };
    job.view.error = result.err();
    job.completed = Some(Instant::now());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> JobRef {
        Arc::new(Mutex::new(Job {
            view: AgentInstallJob {
                id: Uuid::new_v4(),
                executor: BaseCodingAgent::Codex,
                status: InstallStatus::Running,
                logs: String::new(),
                error: None,
            },
            completed: None,
        }))
    }

    #[test]
    fn registry_validation_rejects_non_http_and_credentials() {
        for value in [
            "file:///tmp/registry",
            "https://user:pass@example.com",
            "https://example.com/?token=secret",
            "https://example.com/#fragment",
            "https://example.com/\nattack",
        ] {
            assert!(validate_registry(Some(value)).is_err(), "{value}");
        }
        assert_eq!(
            validate_registry(Some(" https://registry.npmjs.org/ ")).unwrap(),
            Some("https://registry.npmjs.org/".into())
        );
        assert_eq!(validate_registry(Some(" ")).unwrap(), None);
    }

    #[test]
    fn logs_are_bounded_and_utf8_safe() {
        let job = job();
        append_log(&job, "界".repeat(LOG_LIMIT).as_bytes());
        let job = lock(&job);
        assert!(job.view.logs.len() <= LOG_LIMIT);
        assert!(!job.view.logs.is_empty());
    }

    #[test]
    fn registry_is_child_environment_not_shell_text() {
        let registry = "https://example.com/npm/$value;command&other";
        let command = install_command(&AgentInstallRequest {
            executor: BaseCodingAgent::Codex,
            npm_registry: Some(registry.into()),
        })
        .unwrap();
        assert!(
            command
                .as_std()
                .get_envs()
                .any(|(key, value)| key == "npm_config_registry"
                    && value == Some(std::ffi::OsStr::new(registry)))
        );
        assert!(
            command
                .as_std()
                .get_args()
                .all(|arg| !arg.to_string_lossy().contains("example.com"))
        );
        assert!(
            install_command(&AgentInstallRequest {
                executor: BaseCodingAgent::ClaudeCode,
                npm_registry: Some(registry.into())
            })
            .is_err()
        );
    }

    #[test]
    fn expired_jobs_are_removed() {
        let expired = job();
        lock(&expired).completed = Some(Instant::now() - RETENTION);
        let mut jobs = VecDeque::from([expired]);
        prune(&mut jobs);
        assert!(jobs.is_empty());
    }

    #[test]
    fn completed_jobs_are_bounded_but_running_jobs_survive() {
        let running = job();
        let mut jobs = VecDeque::from([running.clone()]);
        for _ in 0..30 {
            let job = job();
            lock(&job).completed = Some(Instant::now());
            jobs.push_back(job);
        }
        prune(&mut jobs);
        assert_eq!(jobs.len(), RETAIN_COMPLETED + 1);
        assert!(Arc::ptr_eq(jobs.front().unwrap(), &running));
    }

    fn mock_command(script: &str) -> Command {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.args(["/d", "/c", script]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", script]);
            command
        };
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        command
    }

    #[tokio::test]
    async fn mock_success_captures_output() {
        let job = job();
        run_install(
            job.clone(),
            mock_command("echo mock-install"),
            Duration::from_secs(10),
        )
        .await;
        let job = lock(&job);
        assert_eq!(job.view.status, InstallStatus::Succeeded);
        assert!(job.view.logs.contains("mock-install"));
    }

    #[tokio::test]
    async fn mock_failure_does_not_claim_success() {
        let job = job();
        run_install(job.clone(), mock_command("exit 7"), Duration::from_secs(10)).await;
        let job = lock(&job);
        assert_eq!(job.view.status, InstallStatus::Failed);
        assert!(job.view.error.is_some());
    }

    #[tokio::test]
    async fn spawn_failure_is_reported() {
        let job = job();
        run_install(
            job.clone(),
            Command::new("vibe-kanban-nonexistent-test-installer"),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(lock(&job).view.status, InstallStatus::Failed);
    }

    #[tokio::test]
    async fn timeout_stops_mock_installer() {
        let job = job();
        #[cfg(windows)]
        let script = "ping -n 30 127.0.0.1 >NUL";
        #[cfg(not(windows))]
        let script = "sleep 30";
        run_install(job.clone(), mock_command(script), Duration::from_millis(50)).await;
        let job = lock(&job);
        assert_eq!(job.view.status, InstallStatus::Failed);
        assert!(job.view.error.as_ref().unwrap().contains("timed out"));
    }
}
