use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use command_group::AsyncCommandGroup;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{mpsc, watch},
};

use super::{
    bad, conflict,
    credentials::{Secret, decode_key, is_link},
    types::GitConnection,
};
use crate::error::ApiError;

mod imported_ssh;

#[derive(Debug, Clone)]
pub struct RemoteUrl {
    pub url: String,
    pub host: String,
    pub username: String,
    pub port: u16,
    pub ssh: bool,
    pub name: String,
}

pub fn parse_url(input: &str) -> Result<RemoteUrl, ApiError> {
    if input.chars().any(char::is_control) {
        return Err(bad("Repository URL contains control characters"));
    }
    let input = input.trim();
    if input.is_empty()
        || input.len() > 4096
        || input.chars().any(|c| c.is_control() || c.is_whitespace())
        || input.contains('\\')
    {
        return Err(bad("Enter a valid SSH or HTTPS repository URL"));
    }
    let normalized = if input.contains("://") {
        input.to_string()
    } else {
        let (authority, path) = input
            .split_once(':')
            .ok_or_else(|| bad("Use ssh://, user@host:path, or https:// repository URLs"))?;
        if !authority.contains('@') || path.is_empty() {
            return Err(bad("Invalid SSH repository URL"));
        }
        format!("ssh://{authority}/{path}")
    };
    let parsed = url::Url::parse(&normalized).map_err(|_| bad("Invalid repository URL"))?;
    let ssh = match parsed.scheme() {
        "ssh" => true,
        "https" => false,
        _ => {
            return Err(bad(
                "Only SSH and HTTPS repositories are supported; local/file/helper transports are not allowed",
            ));
        }
    };
    if parsed.password().is_some()
        || (!ssh && !parsed.username().is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(bad(
            "Do not include passwords, tokens, query strings or fragments in repository URLs",
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| bad("Repository hostname is required"))?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    let username = if parsed.username().is_empty() {
        "git"
    } else {
        parsed.username()
    };
    if host.starts_with('-')
        || (!host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-:".contains(&c)))
        || username.starts_with('-')
        || !username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
    {
        return Err(bad("Invalid repository hostname or SSH username"));
    }
    if parsed.path().is_empty() || parsed.path() == "/" {
        return Err(bad("Repository path is required"));
    }
    let raw_name = parsed
        .path()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("repository")
        .trim_end_matches(".git");
    let name: String = raw_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(60)
        .collect();
    Ok(RemoteUrl {
        url: input.into(),
        host,
        username: username.into(),
        port: parsed.port().unwrap_or(if ssh { 22 } else { 443 }),
        ssh,
        name: if name.is_empty() {
            "repository".into()
        } else {
            name
        },
    })
}

pub fn pin_connection(remote: &RemoteUrl, connection: &GitConnection) -> Result<(), ApiError> {
    if !remote.ssh
        || remote.host != connection.host.to_ascii_lowercase()
        || remote.username != connection.username
        || i64::from(remote.port) != connection.port
    {
        return Err(bad(
            "SSH connection host, port and username must exactly match the repository URL; SSH keys cannot authenticate HTTPS repositories",
        ));
    }
    Ok(())
}

pub fn validate_branch(branch: Option<&str>) -> Result<(), ApiError> {
    if let Some(branch) = branch
        && (branch.is_empty()
            || branch.len() > 1024
            || branch.starts_with('-')
            || !git2::Reference::is_valid_name(&format!("refs/heads/{branch}")))
    {
        return Err(bad("Invalid branch name"));
    }
    Ok(())
}

pub async fn reserve_directory(
    root: &Path,
    remote: &RemoteUrl,
    requested: Option<&str>,
) -> Result<PathBuf, ApiError> {
    let target = if let Some(requested) = requested {
        let path = PathBuf::from(requested);
        if !path.is_absolute()
            || path.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
        {
            return Err(bad(
                "Download directory must be an absolute path without dot segments",
            ));
        }
        path
    } else {
        tokio::fs::create_dir_all(root).await?;
        root.join(format!("{}-{}", remote.name, uuid::Uuid::new_v4()))
    };
    let child = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| bad("Choose a new repository subdirectory, not a drive/root"))?;
    validate_child(child)?;
    let parent = target
        .parent()
        .ok_or_else(|| bad("Download parent is missing"))?;
    let parent = tokio::fs::canonicalize(parent)
        .await
        .map_err(|_| bad("Download parent must exist and be accessible"))?;
    if !tokio::fs::metadata(&parent).await?.is_dir() {
        return Err(bad("Download parent is not a directory"));
    }
    let target = parent.join(child);
    tokio::fs::create_dir(&target).await.map_err(|error|{
        if error.kind()==std::io::ErrorKind::AlreadyExists {conflict(format!("Download directory already exists: {}. Choose a new directory; existing files will not be overwritten.",target.display()))}else{ApiError::from(error)}
    })?;
    verify_target(&target).await?;
    Ok(target)
}

fn validate_child(name: &str) -> Result<(), ApiError> {
    let device = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&device.as_str())
    {
        return Err(bad("Invalid repository directory name"));
    }
    Ok(())
}

pub async fn verify_target(path: &Path) -> Result<(), ApiError> {
    let metadata = tokio::fs::symlink_metadata(path).await?;
    if !metadata.is_dir() || is_link(&metadata) || tokio::fs::canonicalize(path).await? != path {
        return Err(conflict(
            "Reserved repository directory changed; import stopped without deleting files",
        ));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct Progress {
    pub phase: String,
    pub percent: Option<i32>,
}
pub struct Control {
    pub cancel: AtomicBool,
    user_cancel: AtomicBool,
    pub notify: tokio::sync::Notify,
    pub publication: tokio::sync::Mutex<()>,
}
impl Default for Control {
    fn default() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            user_cancel: AtomicBool::new(false),
            notify: Default::default(),
            publication: Default::default(),
        }
    }
}
impl Control {
    pub fn user_cancelled(&self) -> bool {
        self.user_cancel.load(Ordering::Acquire)
    }
    pub fn request_user_cancel(&self) {
        self.user_cancel.store(true, Ordering::Release);
        self.request_cancel();
    }
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Acquire)
    }
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }
}

// Parameters are fixed, never interpolate caller strings into shell-parsed SSH commands.
fn native_command() -> Command {
    let mut command = Command::new("git");
    command.args(["-c","protocol.allow=never","-c","protocol.ssh.allow=always","-c","protocol.https.allow=always"])
        .env("GIT_TERMINAL_PROMPT","0").env("GCM_INTERACTIVE","Never")
        .env("GIT_SSH_COMMAND","ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=15 -oServerAliveInterval=15 -oServerAliveCountMax=2")
        .env("GIT_SSH_VARIANT","ssh").env_remove("GIT_ASKPASS").env_remove("SSH_ASKPASS")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    command
}

async fn drain<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
    progress: Option<mpsc::Sender<Progress>>,
) -> Result<Vec<u8>, std::io::Error> {
    let mut captured = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        if let Some(sender) = &progress {
            let _ = sender.try_send(Progress {
                phase: "downloading".into(),
                percent: parse_percent(&buffer[..count]),
            });
        }
        if captured.len() < limit {
            let remaining = limit - captured.len();
            captured.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }
    Ok(captured)
}

fn parse_percent(bytes: &[u8]) -> Option<i32> {
    let text = String::from_utf8_lossy(bytes);
    text.rsplit_once('%')
        .and_then(|(before, _)| before.rsplit(|c: char| !c.is_ascii_digit()).next())
        .and_then(|digits| digits.parse::<i32>().ok())
        .map(|n| n.clamp(0, 100))
}

fn native_error(stderr: &[u8]) -> ApiError {
    let message = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if message.contains("host key verification")
        || message.contains("host identification has changed")
    {
        conflict(
            "SSH host key is unknown or changed. Verify the server fingerprint out-of-band and configure this host's known_hosts, then retry; host-key verification was not bypassed.",
        )
    } else if message.contains("permission denied")
        || message.contains("authentication")
        || message.contains("could not read username")
    {
        conflict(
            "Git authentication failed. Check the local SSH agent/key configuration or HTTPS credential helper and repository access.",
        )
    } else if message.contains("resolve hostname") || message.contains("resolve host") {
        conflict("Git hostname could not be resolved; check URL and network configuration.")
    } else {
        conflict(
            "Git operation failed. Check repository URL, selected branch, access permissions and local Git/SSH configuration. Partial clone files were retained.",
        )
    }
}

type WriterRecord = (sqlx::SqlitePool, uuid::Uuid);
async fn save_writer(writer: &Option<WriterRecord>, pid: i64) -> Result<(), ApiError> {
    if let Some((pool, id)) = writer {
        sqlx::query("UPDATE git_import_jobs SET writer_pid=? WHERE id=?")
            .bind(pid)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub fn writer_absent(pid: i64, group: bool) -> bool {
    if pid <= 0 || pid > u32::MAX as i64 {
        return false;
    }
    #[cfg(unix)]
    {
        if pid > i32::MAX as i64 {
            return false;
        }
        let target = if group { -(pid as i32) } else { pid as i32 };
        unsafe {
            libc::kill(target, 0) == -1
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        }
    }
    #[cfg(windows)]
    {
        let _ = group;
        use windows_sys::Win32::{
            Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, GetLastError},
            System::Threading::{
                GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        };
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
            if handle.is_null() {
                return GetLastError() == ERROR_INVALID_PARAMETER;
            }
            let mut code = 259;
            let success = GetExitCodeProcess(handle, &mut code) != 0;
            CloseHandle(handle);
            success && code != 259
        }
    }
}

async fn native_execute(
    mut command: Command,
    control: Arc<Control>,
    progress: Option<mpsc::Sender<Progress>>,
    writer: Option<WriterRecord>,
) -> Result<Vec<u8>, ApiError> {
    if control.cancelled() {
        return Err(conflict("Import cancelled"));
    }
    save_writer(&writer, -1).await?;
    let mut child = spawn_group(&mut command)?;
    let registration = save_writer(&writer, i64::from(child.id().unwrap_or(0))).await;
    if registration.is_err() {
        control.request_cancel();
    }
    let stdout = child
        .inner()
        .stdout
        .take()
        .ok_or_else(|| conflict("Git output pipe unavailable"))?;
    let stderr = child
        .inner()
        .stderr
        .take()
        .ok_or_else(|| conflict("Git error pipe unavailable"))?;
    let output = tokio::spawn(drain(stdout, 4 * 1024 * 1024, None));
    let errors = tokio::spawn(drain(stderr, 64 * 1024, progress));
    let status = loop {
        tokio::select! {
            status=child.wait()=>match status{Ok(status)=>break status,Err(_)=>control.request_cancel()},
            _=control.notify.notified()=>{},
            _=tokio::time::sleep(Duration::from_millis(250))=>{},
        }
        if control.cancelled() {
            // Do not report cancelled or release the credential until group exit
            // is actually established. An unreachable group stays cancelling.
            match utils::process::kill_process_group(&mut child).await {
                Ok(()) => break child.wait().await?,
                Err(_) => tokio::time::sleep(Duration::from_secs(1)).await,
            }
        }
    };
    let mut output = output;
    let mut errors = errors;
    // Even after the leader exits, inherited output handles may belong to its
    // descendants. Keep the captured group available for cancellation.
    let readers = async {
        Ok::<_, ApiError>((
            (&mut output)
                .await
                .map_err(|_| conflict("Git output reader failed"))??,
            (&mut errors)
                .await
                .map_err(|_| conflict("Git diagnostic reader failed"))??,
        ))
    };
    tokio::pin!(readers);
    let (output_bytes, error_bytes) = loop {
        tokio::select! {
            result=&mut readers=>match result {
                Ok(bytes)=>break bytes,
                Err(error)=>{
                    while utils::process::kill_process_group(&mut child).await.is_err() {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    return Err(error);
                }
            },
            _=control.notify.notified()=>{},
            _=tokio::time::sleep(Duration::from_millis(250))=>{}
        }
        if control.cancelled() {
            if utils::process::kill_process_group(&mut child).await.is_ok() {
                break tokio::time::timeout(Duration::from_secs(5), &mut readers)
                    .await
                    .map_err(|_| conflict("Git output did not close after cancellation"))??;
            }
        }
    };
    registration?;
    if control.cancelled() {
        return Err(conflict(if control.user_cancelled() {
            "Import cancelled; partial directory retained"
        } else {
            "Git operation aborted after an internal transport failure; partial directory retained"
        }));
    }
    if !status.success() {
        return Err(native_error(&error_bytes));
    }
    if output_bytes.len() >= 4 * 1024 * 1024 {
        return Err(conflict(
            "Remote branch response is too large; narrow the repository selection",
        ));
    }
    Ok(output_bytes)
}

pub async fn inspect_native(remote: &RemoteUrl) -> Result<(Vec<String>, Option<String>), ApiError> {
    let mut command = native_command();
    command.args([
        "ls-remote",
        "--symref",
        "--",
        &remote.url,
        "HEAD",
        "refs/heads/*",
    ]);
    let control = Arc::new(Control::default());
    let operation = native_execute(command, control.clone(), None, None);
    tokio::pin!(operation);
    let output = tokio::select! {result=&mut operation=>result?,_=tokio::time::sleep(Duration::from_secs(45))=>{control.request_cancel();let _=operation.await;return Err(conflict("Remote branch inspection timed out; check SSH/network configuration"));}};
    Ok(parse_native_refs(&output))
}

fn parse_native_refs(output: &[u8]) -> (Vec<String>, Option<String>) {
    let mut branches = Vec::new();
    let mut default = None;
    for line in String::from_utf8_lossy(&output).lines() {
        if let Some((left, right)) = line.split_once('\t') {
            if let Some(branch) = right.strip_prefix("refs/heads/") {
                if git2::Reference::is_valid_name(right) {
                    branches.push(branch.into());
                }
            }
            if right == "HEAD" {
                if let Some(branch) = left.strip_prefix("ref: refs/heads/") {
                    default = Some(branch.to_string());
                }
            }
        }
    }
    branches.sort();
    branches.dedup();
    (branches, default)
}

pub async fn clone_native(
    remote: &RemoteUrl,
    branch: Option<&str>,
    path: &Path,
    control: Arc<Control>,
    progress: mpsc::Sender<Progress>,
    writer: WriterRecord,
) -> Result<(), ApiError> {
    let mut command = native_command();
    command.args(["clone", "--progress", "--no-local"]);
    if let Some(branch) = branch {
        command.args(["--branch", branch]);
    }
    command.arg("--").arg(&remote.url).arg(path);
    native_execute(command, control, Some(progress), Some(writer))
        .await
        .map(|_| ())
}

fn callbacks(
    control: Arc<Control>,
    progress: Option<mpsc::Sender<Progress>>,
    stages: mpsc::Sender<WorkerStage>,
) -> git2::RemoteCallbacks<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();
    let transfer_stages = stages.clone();
    let cancellation = control.clone();
    let sender = progress.clone();
    let mut transfer_started = false;
    callbacks.transfer_progress(move |stats| {
        if !transfer_started {
            let _ = transfer_stages.blocking_send(WorkerStage::Downloading);
            transfer_started = true;
        }
        if let Some(sender) = &sender {
            let _ = sender.try_send(Progress {
                phase: "downloading".into(),
                percent: if stats.total_objects() > 0 {
                    Some((100 * stats.received_objects() / stats.total_objects()) as i32)
                } else {
                    None
                },
            });
        }
        !cancellation.cancelled()
    });
    callbacks.sideband_progress(move |_| !control.cancelled());
    // ImportedTransport validates known_hosts before offering its single key.
    // No libgit2 credential callback/fallback: SSH is owned by that transport.
    callbacks
}

fn imported_error(error: git2::Error) -> ApiError {
    if let Some(reason) = imported_ssh::safe_failure_reason(error.message()) {
        return conflict(format!(
            "SSH Git operation failed: {reason}. Check network, SSH server configuration and repository access; partial files were retained."
        ));
    }
    match error.code() {
        git2::ErrorCode::Certificate => conflict(
            "SSH host key is unknown, changed or revoked, or known_hosts could not be read. Verify the server fingerprint and configure .ssh/known_hosts for this host/port before retrying.",
        ),
        git2::ErrorCode::Auth => conflict(
            "SSH key authentication failed. Check username, private-key algorithm support in this installation, and repository permission.",
        ),
        git2::ErrorCode::NotFound => conflict("Repository or selected branch was not found."),
        _ => {
            // Classify library text locally; it may contain remote-controlled
            // data and must never be copied into API responses or logs.
            let message = error.message().to_ascii_lowercase();
            let reason = if message.contains("resolve") || message.contains("getaddrinfo") {
                "hostname resolution failed"
            } else if message.contains("timed out") || message.contains("timeout") {
                "network or SSH operation timed out"
            } else if message.contains("refused") {
                "network connection refused"
            } else if message.contains("handshake") || message.contains("banner") {
                "SSH handshake failed"
            } else if message.contains("key exchange") || message.contains("kex") {
                "SSH key exchange failed"
            } else if message.contains("socket") || message.contains("connection") {
                "network connection failed"
            } else {
                "unclassified transport failure"
            };
            conflict(format!(
                "SSH Git operation failed: {reason} (code: {:?}; class: {:?}). Check network, known_hosts and repository access; partial files were retained.",
                error.code(),
                error.class()
            ))
        }
    }
}

fn spawn_group(command: &mut Command) -> Result<command_group::AsyncGroupChild, std::io::Error> {
    let mut group = command.group();
    group.kill_on_drop(true);
    #[cfg(windows)]
    group.creation_flags(0x08000000);
    group.spawn()
}

#[derive(Serialize, Deserialize)]
struct WorkerInput {
    url: String,
    branch: Option<String>,
    directory: Option<PathBuf>,
    secret: Secret,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WorkerStage {
    Starting,
    ReadingRequest,
    DecodingKey,
    InitializingTransport,
    ConnectingSsh,
    Authenticating,
    ReadingRefs,
    Downloading,
    Checkout,
}

impl WorkerStage {
    fn description(self) -> &'static str {
        match self {
            Self::Starting => "worker startup",
            Self::ReadingRequest => "reading worker request",
            Self::DecodingKey => "decoding private key",
            Self::InitializingTransport => "initializing Git transport",
            Self::ConnectingSsh => "SSH connection/handshake",
            Self::Authenticating => "SSH key authentication",
            Self::ReadingRefs => "reading repository references",
            Self::Downloading => "downloading repository objects",
            Self::Checkout => "checking out repository files",
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum WorkerStopReason {
    InputDelivery,
    InspectionTimeout,
    OutputReader,
    ProcessWait,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WorkerOutput {
    Stage {
        value: WorkerStage,
    },
    Progress {
        value: Progress,
    },
    Inspected {
        branches: Vec<String>,
        default_branch: Option<String>,
    },
    Complete,
    Error {
        message: String,
    },
}

async fn emit(output: &WorkerOutput) -> Result<(), ApiError> {
    let mut bytes =
        serde_json::to_vec(output).map_err(|_| conflict("Git worker serialization failed"))?;
    bytes.push(b'\n');
    let mut stdout = tokio::io::stdout();
    stdout.write_all(&bytes).await?;
    stdout.flush().await?;
    Ok(())
}

// Invoked only by the early internal mode in server main: no HTTP listener,
// tracing, database migration or runtime startup in this process.
pub async fn worker_main() -> Result<(), ApiError> {
    emit(&WorkerOutput::Stage {
        value: WorkerStage::ReadingRequest,
    })
    .await?;
    let mut stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    loop {
        let byte = stdin.read_u8().await?;
        bytes.push(byte);
        if bytes.len() > 160 * 1024 {
            return Err(bad("Git worker request is too large"));
        }
        if byte == b'\n' {
            break;
        }
    }
    let input: WorkerInput =
        serde_json::from_slice(&bytes).map_err(|_| bad("Invalid Git worker request"))?;
    let remote = parse_url(&input.url)?;
    validate_branch(input.branch.as_deref())?;
    if !remote.ssh {
        return Err(bad("Imported keys only support SSH"));
    }
    // Parent retains the anonymous input pipe for the entire operation. EOF
    // means its owner died; terminate the isolated Git/SSH process even when
    // an operation is waiting on a stalled remote and cannot report progress.
    tokio::spawn(async move {
        let mut byte = [0u8; 1];
        loop {
            match stdin.read(&mut byte).await {
                Ok(0) | Err(_) => std::process::exit(3),
                Ok(_) => {}
            }
        }
    });
    let control = Arc::new(Control::default());
    let (stages, mut stage_receiver) = mpsc::channel(16);
    let (progress, mut progress_receiver) = mpsc::channel(8);
    let operation = async move {
        if let Some(directory) = input.directory {
            clone_in_worker(
                remote,
                input.secret,
                input.branch,
                directory,
                control,
                progress,
                stages,
            )
            .await
            .map(|()| WorkerOutput::Complete)
        } else {
            inspect_in_worker(remote, input.secret, control, stages)
                .await
                .map(|(branches, default_branch)| WorkerOutput::Inspected {
                    branches,
                    default_branch,
                })
        }
    };
    tokio::pin!(operation);
    let result = loop {
        tokio::select! {
            result = &mut operation => break result,
            Some(value) = stage_receiver.recv() => emit(&WorkerOutput::Stage { value }).await?,
            Some(value) = progress_receiver.recv() => emit(&WorkerOutput::Progress { value }).await?,
        }
    };
    while let Ok(value) = stage_receiver.try_recv() {
        emit(&WorkerOutput::Stage { value }).await?;
    }
    match result {
        Ok(result) => emit(&result).await,
        Err(error) => {
            emit(&WorkerOutput::Error {
                message: error.to_string(),
            })
            .await
        }
    }
}

async fn read_worker(
    mut stdout: tokio::process::ChildStdout,
    progress: Option<mpsc::Sender<Progress>>,
    stages: watch::Sender<WorkerStage>,
) -> Result<Option<WorkerOutput>, ApiError> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut final_result = None;
    loop {
        let count = stdout.read(&mut chunk).await?;
        if count == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..count]);
        if buffer.len() > 4 * 1024 * 1024 {
            return Err(conflict("Git worker output exceeded the response limit"));
        }
        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline).collect();
            let output: WorkerOutput = serde_json::from_slice(&line)
                .map_err(|_| conflict("Invalid Git worker response"))?;
            match output {
                WorkerOutput::Stage { value } => {
                    tracing::debug!(stage = ?value, "git import worker stage");
                    stages.send_replace(value);
                }
                WorkerOutput::Progress { value } => {
                    if let Some(sender) = &progress {
                        let _ = sender.try_send(value);
                    }
                }
                value => {
                    if final_result.is_some() {
                        return Err(conflict("Duplicate Git worker result"));
                    }
                    final_result = Some(value);
                }
            }
        }
    }
    if !buffer.is_empty() {
        return Err(conflict("Incomplete Git worker response"));
    }
    Ok(final_result)
}

// Never return raw diagnostics: panic payloads and third-party libraries may
// include arbitrary input. Only fixed categories and the byte count escape.
fn worker_stderr_summary(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    let category = if bytes.is_empty() {
        "empty"
    } else if text.contains("panicked at") {
        "worker panic"
    } else if text.contains("dll") || text.contains("shared librar") {
        "runtime library loading failure"
    } else if text.contains("permission denied") || text.contains("access is denied") {
        "permission denied"
    } else if text.contains("out of memory") || text.contains("memory allocation") {
        "memory allocation failure"
    } else {
        "unclassified diagnostic (raw content withheld)"
    };
    format!("{category}; {} bytes retained (limit 16384)", bytes.len())
}

async fn run_worker(
    input: WorkerInput,
    control: Arc<Control>,
    progress: Option<mpsc::Sender<Progress>>,
    inspection: bool,
    writer: Option<WriterRecord>,
) -> Result<WorkerOutput, ApiError> {
    let executable = std::env::current_exe().map_err(|error| {
        tracing::error!(error = %error, "git import worker executable lookup failed");
        ApiError::from(error)
    })?;
    let mut command = Command::new(&executable);
    command.arg("--git-import-worker");
    supervise_worker(
        command,
        input,
        control,
        progress,
        inspection.then_some(Duration::from_secs(45)),
        writer,
    )
    .await
}

async fn supervise_worker(
    mut command: Command,
    input: WorkerInput,
    control: Arc<Control>,
    progress: Option<mpsc::Sender<Progress>>,
    inspection_timeout: Option<Duration>,
    writer: Option<WriterRecord>,
) -> Result<WorkerOutput, ApiError> {
    let executable = command
        .as_std()
        .get_program()
        .to_string_lossy()
        .into_owned();
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    save_writer(&writer, -1).await?;
    let mut child = match spawn_group(&mut command) {
        Ok(child) => child,
        Err(error) => {
            tracing::error!(
                executable = %executable,
                error = %error,
                "git import worker spawn failed"
            );
            return Err(error.into());
        }
    };
    tracing::debug!(
        executable = %executable,
        pid = child.id().unwrap_or_default(),
        inspection = inspection_timeout.is_some(),
        "git import worker spawned"
    );
    let registration = save_writer(&writer, i64::from(child.id().unwrap_or(0))).await;
    if registration.is_err() {
        control.request_cancel();
    }
    let mut stdin = child
        .inner()
        .stdin
        .take()
        .ok_or_else(|| conflict("Git worker input pipe unavailable"))?;
    let stdout = child
        .inner()
        .stdout
        .take()
        .ok_or_else(|| conflict("Git worker output pipe unavailable"))?;
    let (stages, last_stage) = watch::channel(WorkerStage::Starting);
    let mut reader = tokio::spawn(read_worker(stdout, progress, stages));
    let stderr = child.inner().stderr.take().expect("piped worker stderr");
    let mut diagnostics = tokio::spawn(drain(stderr, 16384, None));
    let mut bytes = zeroize::Zeroizing::new(
        serde_json::to_vec(&input).map_err(|_| bad("Invalid Git worker request"))?,
    );
    bytes.push(b'\n');
    // The helper reads immediately, but still bound delivery in case a stale
    // executable does not implement this internal mode. Never release a live
    // helper merely because input delivery failed.
    let delivery_failed = !control.cancelled()
        && !matches!(
            tokio::time::timeout(Duration::from_secs(10), stdin.write_all(&bytes)).await,
            Ok(Ok(()))
        );
    if delivery_failed {
        control.request_cancel();
    }
    let mut stop_reason = delivery_failed.then_some(WorkerStopReason::InputDelivery);
    drop(bytes);
    drop(input);
    let started = tokio::time::Instant::now();
    let mut response = None;
    let status = loop {
        tokio::select! {
            // stdin was taken from Child and remains owned here until exit.
            result = child.wait() => match result {
                Ok(status) => break status,
                Err(_) => {
                    stop_reason.get_or_insert(WorkerStopReason::ProcessWait);
                    control.request_cancel();
                },
            },
            result = &mut reader, if response.is_none() => {
                let result = result
                    .map_err(|_| conflict("Git worker reader failed"))
                    .and_then(|result| result);
                if result.is_err() {
                    stop_reason.get_or_insert(WorkerStopReason::OutputReader);
                    control.request_cancel();
                }
                response = Some(result);
            },
            _=control.notify.notified()=>{},
            _=tokio::time::sleep(Duration::from_millis(100))=>{},
        }
        if !control.cancelled()
            && inspection_timeout.is_some_and(|timeout| started.elapsed() >= timeout)
        {
            stop_reason = Some(WorkerStopReason::InspectionTimeout);
            control.request_cancel();
        }
        if control.cancelled() {
            match utils::process::kill_process_group(&mut child).await {
                Ok(()) => break child.wait().await?,
                Err(_) => tokio::time::sleep(Duration::from_secs(1)).await,
            }
        }
    };
    tracing::debug!(
        pid = child.id().unwrap_or_default(),
        status = %status,
        success = status.success(),
        inspection = inspection_timeout.is_some(),
        ?stop_reason,
        stage = ?*last_stage.borrow(),
        "git import worker exited"
    );
    drop(stdin);
    let diagnostic_summary =
        match tokio::time::timeout(Duration::from_secs(5), &mut diagnostics).await {
            Ok(Ok(Ok(bytes))) => worker_stderr_summary(&bytes),
            _ => {
                diagnostics.abort();
                "diagnostic stream unavailable".to_string()
            }
        };
    if response.is_none() {
        response = Some(
            match tokio::time::timeout(Duration::from_secs(5), &mut reader).await {
                Ok(result) => result
                    .map_err(|_| conflict("Git worker reader failed"))
                    .and_then(|result| result),
                Err(_) => {
                    reader.abort();
                    Err(conflict("Git worker output did not close"))
                }
            },
        );
    }
    registration?;
    let stage = last_stage.borrow().description();
    if control.user_cancelled() {
        return Err(conflict("SSH import cancelled; partial files retained"));
    }
    // A deliberate stop often yields clean stdout EOF and exit code 1 on
    // Windows. Preserve the stop cause before interpreting those symptoms.
    if matches!(stop_reason, Some(WorkerStopReason::InspectionTimeout)) {
        return Err(conflict(format!(
            "SSH inspection timed out after {} seconds; last stage: {stage}. Check network/SSH configuration and retry.",
            inspection_timeout.unwrap().as_secs()
        )));
    }
    if matches!(stop_reason, Some(WorkerStopReason::InputDelivery)) {
        return Err(conflict(format!(
            "Git worker input delivery failed or timed out; last stage: {stage}; helper was stopped and partial files retained"
        )));
    }
    if matches!(stop_reason, Some(WorkerStopReason::ProcessWait)) {
        return Err(conflict(
            "Git worker process supervision failed; helper was stopped and partial files retained",
        ));
    }
    if control.cancelled() {
        if let Some(Err(error)) = response {
            return Err(conflict(format!("{error}; last stage: {stage}")));
        }
        return Err(conflict(format!(
            "SSH import aborted after an internal transport failure; last stage: {stage}; partial files retained"
        )));
    }
    if matches!(&response, Some(Ok(None))) {
        return Err(conflict(format!(
            "Git worker exited without a result; last stage: {stage}; exit status: {status}; stderr: {diagnostic_summary}"
        )));
    }
    // A worker error frame is the canonical diagnostic, even when the helper
    // exits non-zero after emitting it. Preserve that message instead of
    // replacing it with the generic process-start failure.
    if let Some(Ok(Some(WorkerOutput::Error { message }))) = response.as_ref() {
        return Err(conflict(format!("{message}; last stage: {stage}")));
    }
    if !status.success() {
        return Err(conflict(format!(
            "Git SSH worker exited unexpectedly; last stage: {stage}; exit status: {status}; stderr: {diagnostic_summary}"
        )));
    }
    match response.unwrap()?.ok_or_else(|| conflict(format!("Git worker exited without a result; last stage: {stage}; exit status: {status}; stderr: {diagnostic_summary}")))? {
        WorkerOutput::Error { message } => Err(conflict(message)),
        result => Ok(result),
    }
}

pub async fn inspect_imported(
    remote: RemoteUrl,
    secret: Secret,
    control: Arc<Control>,
) -> Result<(Vec<String>, Option<String>), ApiError> {
    match run_worker(
        WorkerInput {
            url: remote.url,
            branch: None,
            directory: None,
            secret,
        },
        control,
        None,
        true,
        None,
    )
    .await?
    {
        WorkerOutput::Inspected {
            branches,
            default_branch,
        } => Ok((branches, default_branch)),
        _ => Err(conflict("Unexpected SSH inspection result")),
    }
}

pub async fn clone_imported(
    remote: RemoteUrl,
    secret: Secret,
    branch: Option<String>,
    path: PathBuf,
    control: Arc<Control>,
    progress: mpsc::Sender<Progress>,
    writer: WriterRecord,
) -> Result<(), ApiError> {
    match run_worker(
        WorkerInput {
            url: remote.url,
            branch,
            directory: Some(path),
            secret,
        },
        control,
        Some(progress),
        false,
        Some(writer),
    )
    .await?
    {
        WorkerOutput::Complete => Ok(()),
        _ => Err(conflict("Unexpected SSH import result")),
    }
}

async fn inspect_in_worker(
    remote: RemoteUrl,
    secret: Secret,
    control: Arc<Control>,
    stages: mpsc::Sender<WorkerStage>,
) -> Result<(Vec<String>, Option<String>), ApiError> {
    tokio::task::spawn_blocking(move || {
        let _ = stages.blocking_send(WorkerStage::DecodingKey);
        let key = decode_key(&secret)?;
        let _ = stages.blocking_send(WorkerStage::InitializingTransport);
        imported_ssh::register_for_worker(remote.clone(), key, control.clone(), stages.clone())
            .map_err(imported_error)?;
        let mut repository =
            git2::Remote::create_detached(remote.url.as_str()).map_err(imported_error)?;
        let connection = repository
            .connect_auth(
                git2::Direction::Fetch,
                Some(callbacks(control, None, stages.clone())),
                None,
            )
            .map_err(imported_error)?;
        let mut branches = Vec::new();
        let mut default = None;
        for head in connection.list().map_err(imported_error)? {
            if let Some(branch) = head.name().strip_prefix("refs/heads/") {
                branches.push(branch.to_string());
            }
            if head.name() == "HEAD" {
                default = head
                    .symref_target()
                    .and_then(|r| r.strip_prefix("refs/heads/"))
                    .map(str::to_string);
            }
        }
        branches.sort();
        branches.dedup();
        Ok((branches, default))
    })
    .await
    .map_err(|_| conflict("SSH inspection worker failed"))?
}

async fn clone_in_worker(
    remote: RemoteUrl,
    secret: Secret,
    branch: Option<String>,
    path: PathBuf,
    control: Arc<Control>,
    progress: mpsc::Sender<Progress>,
    stages: mpsc::Sender<WorkerStage>,
) -> Result<(), ApiError> {
    tokio::task::spawn_blocking(move || {
        let _ = stages.blocking_send(WorkerStage::DecodingKey);
        let key = decode_key(&secret)?;
        let _ = stages.blocking_send(WorkerStage::InitializingTransport);
        imported_ssh::register_for_worker(remote.clone(), key, control.clone(), stages.clone())
            .map_err(imported_error)?;
        let mut fetch = git2::FetchOptions::new();
        fetch.remote_callbacks(callbacks(
            control.clone(),
            Some(progress.clone()),
            stages.clone(),
        ));
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout
            .notify_on(git2::CheckoutNotificationType::all())
            .notify(move |_, _, _, _, _| !control.cancelled());
        let checkout_stages = stages.clone();
        let mut checkout_started = false;
        checkout.progress(move |_, current, total| {
            if !checkout_started {
                let _ = checkout_stages.blocking_send(WorkerStage::Checkout);
                checkout_started = true;
            }
            let _ = progress.try_send(Progress {
                phase: "checkout".into(),
                percent: if total > 0 {
                    Some((100 * current / total) as i32)
                } else {
                    None
                },
            });
        });
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch).with_checkout(checkout);
        if let Some(branch) = &branch {
            builder.branch(branch);
        }
        builder.clone(&remote.url, &path).map_err(imported_error)?;
        Ok(())
    })
    .await
    .map_err(|_| conflict("SSH clone worker failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn supervision_input() -> WorkerInput {
        WorkerInput {
            url: "ssh://git@127.0.0.1/synthetic-repo".into(),
            branch: None,
            directory: None,
            secret: Secret {
                private_key: Some("synthetic-private-key-marker".into()),
                password: Some("synthetic-passphrase-marker".into()),
            },
        }
    }

    enum SupervisionFixture {
        Stall,
        UnexpectedEof,
        ErrorThenNonzeroExit,
    }

    fn supervision_fixture(fixture: SupervisionFixture) -> Command {
        // Exercise the production parent with a real child and pipe EOF. The
        // real libgit2 helper's handshake is covered in git_import_worker.rs.
        #[cfg(windows)]
        {
            let mut command = Command::new("powershell.exe");
            command.args(["-NoProfile", "-NonInteractive", "-Command"]);
            command.arg(match fixture {
                SupervisionFixture::Stall => r#"[Console]::In.ReadLine() | Out-Null; [Console]::Out.WriteLine('{"kind":"stage","value":"connecting_ssh"}'); [Console]::Out.WriteLine('{"kind":"progress","value":{"phase":"fixture_ready","percent":null}}'); [Console]::Out.Flush(); Start-Sleep -Seconds 60"#,
                SupervisionFixture::UnexpectedEof => r#"[Console]::In.ReadLine() | Out-Null; [Console]::Out.WriteLine('{"kind":"stage","value":"reading_request"}'); [Console]::Out.Flush(); exit 1"#,
                SupervisionFixture::ErrorThenNonzeroExit => r#"[Console]::In.ReadLine() | Out-Null; [Console]::Out.WriteLine('{"kind":"stage","value":"decoding_key"}'); [Console]::Out.WriteLine('{"kind":"error","message":"Synthetic key validation failed"}'); [Console]::Out.Flush(); exit 2"#,
            });
            command
        }
        #[cfg(unix)]
        {
            let mut command = Command::new("sh");
            command.arg("-c").arg(match fixture {
                SupervisionFixture::Stall => r#"read -r request; printf '%s\n' '{"kind":"stage","value":"connecting_ssh"}' '{"kind":"progress","value":{"phase":"fixture_ready","percent":null}}'; sleep 60"#,
                SupervisionFixture::UnexpectedEof => r#"read -r request; printf '%s\n' '{"kind":"stage","value":"reading_request"}'; exit 1"#,
                SupervisionFixture::ErrorThenNonzeroExit => r#"read -r request; printf '%s\n' '{"kind":"stage","value":"decoding_key"}' '{"kind":"error","message":"Synthetic key validation failed"}'; exit 2"#,
            });
            command
        }
    }

    #[tokio::test]
    async fn parent_supervision_reports_deadline_and_reaps_before_returning() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE git_import_jobs (id BLOB PRIMARY KEY, writer_pid INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        let id = uuid::Uuid::new_v4();
        sqlx::query("INSERT INTO git_import_jobs(id) VALUES (?)")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let control = Arc::new(Control::default());
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            supervise_worker(
                supervision_fixture(SupervisionFixture::Stall),
                supervision_input(),
                control.clone(),
                None,
                Some(Duration::from_secs(5)),
                Some((pool.clone(), id)),
            ),
        )
        .await
        .expect("deadline must stop and reap the actual child");
        let message = result.err().expect("fixture must time out").to_string();
        assert!(
            message.contains("inspection timed out after 5 seconds"),
            "{message}"
        );
        assert!(
            message.contains("last stage: SSH connection/handshake"),
            "{message}"
        );
        assert!(!message.contains("without a result"), "{message}");
        assert!(!message.contains("synthetic-private-key-marker"));
        assert!(!message.contains("synthetic-passphrase-marker"));
        assert!(!control.user_cancelled());
        let pid: i64 = sqlx::query_scalar("SELECT writer_pid FROM git_import_jobs WHERE id=?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(pid > 0);
        assert!(
            writer_absent(pid, false),
            "parent returned before worker exit"
        );
    }

    #[tokio::test]
    async fn parent_supervision_keeps_cancellation_distinct_from_timeout() {
        for user_cancel in [false, true] {
            let control = Arc::new(Control::default());
            let (progress, mut ready) = mpsc::channel(1);
            let operation = supervise_worker(
                supervision_fixture(SupervisionFixture::Stall),
                supervision_input(),
                control.clone(),
                Some(progress),
                Some(Duration::from_secs(30)),
                None,
            );
            tokio::pin!(operation);
            tokio::time::timeout(Duration::from_secs(10), async {
                tokio::select! {
                    _ = &mut operation => panic!("fixture exited before cancellation"),
                    progress = ready.recv() => assert_eq!(progress.unwrap().phase, "fixture_ready"),
                }
            })
            .await
            .expect("fixture must start");
            if user_cancel {
                control.request_user_cancel();
            } else {
                control.request_cancel();
            }
            let message = tokio::time::timeout(Duration::from_secs(15), operation)
                .await
                .expect("cancellation must reap the child")
                .err()
                .expect("cancellation must fail the operation")
                .to_string();
            assert!(
                message.contains(if user_cancel {
                    "SSH import cancelled"
                } else {
                    "internal transport failure"
                }),
                "{message}"
            );
            assert!(!message.contains("timed out"), "{message}");
            assert!(!message.contains("without a result"), "{message}");
        }
    }

    #[tokio::test]
    async fn parent_supervision_distinguishes_unexpected_eof() {
        let message = tokio::time::timeout(
            Duration::from_secs(10),
            supervise_worker(
                supervision_fixture(SupervisionFixture::UnexpectedEof),
                supervision_input(),
                Arc::new(Control::default()),
                None,
                Some(Duration::from_secs(5)),
                None,
            ),
        )
        .await
        .unwrap()
        .err()
        .expect("fixture exits without a terminal frame")
        .to_string();
        assert!(message.contains("without a result"), "{message}");
        assert!(
            message.contains("last stage: reading worker request"),
            "{message}"
        );
        assert!(!message.contains("timed out"), "{message}");
    }

    #[tokio::test]
    async fn parent_supervision_preserves_error_frame_on_nonzero_exit() {
        let message = tokio::time::timeout(
            Duration::from_secs(10),
            supervise_worker(
                supervision_fixture(SupervisionFixture::ErrorThenNonzeroExit),
                supervision_input(),
                Arc::new(Control::default()),
                None,
                Some(Duration::from_secs(5)),
                None,
            ),
        )
        .await
        .expect("parent must reap the helper after its terminal error")
        .err()
        .expect("error frame must fail the operation even after helper exit")
        .to_string();
        assert!(
            message.contains("Synthetic key validation failed"),
            "{message}"
        );
        assert!(
            message.contains("last stage: decoding private key"),
            "{message}"
        );
        assert!(!message.contains("exited unexpectedly"), "{message}");
        assert!(!message.contains("without a result"), "{message}");
        assert!(!message.contains("timed out"), "{message}");
        assert!(!message.contains("synthetic-private-key-marker"));
        assert!(!message.contains("synthetic-passphrase-marker"));
    }

    #[test]
    fn imported_diagnostics_classify_without_disclosing_library_text() {
        for (raw, expected) in [
            ("failed to resolve address", "hostname resolution failed"),
            ("connection refused", "network connection refused"),
            ("failed SSH handshake", "SSH handshake failed"),
            ("SSH timeout", "network or SSH operation timed out"),
        ] {
            let error = git2::Error::from_str(&format!("{raw}: PRIVATE KEY secret-passphrase"));
            let message = imported_error(error).to_string();
            assert!(message.contains(expected), "{message}");
            assert!(!message.contains("PRIVATE KEY"));
            assert!(!message.contains("secret-passphrase"));
        }
        assert!(
            serde_json::from_str::<WorkerOutput>(
                r#"{"kind":"stage","value":"arbitrary secret text"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn symbolic_head_survives_oid_head_and_branches_are_sorted() {
        let (branches, default) = parse_native_refs(b"ref: refs/heads/main\tHEAD\nabc\tHEAD\nabc\trefs/heads/main\ndef\trefs/heads/feature/a\nabc\trefs/heads/main\n");
        assert_eq!(default.as_deref(), Some("main"));
        assert_eq!(branches, ["feature/a", "main"]);
    }

    #[test]
    fn internal_abort_is_not_a_user_cancel() {
        let control = Control::default();
        control.request_cancel();
        assert!(control.cancelled());
        assert!(!control.user_cancelled());
        control.request_user_cancel();
        assert!(control.user_cancelled());
    }

    #[test]
    fn worker_startup_failures_are_terminal_protocol_frames() {
        let frame = format!(
            "{{\"kind\":\"error\",\"message\":{}}}",
            serde_json::to_string("Invalid Git worker request").unwrap()
        );
        let parsed: WorkerOutput = serde_json::from_str(&frame).unwrap();
        assert!(matches!(parsed, WorkerOutput::Error { .. }));
    }
    #[test]
    fn urls_and_branches_reject_helper_and_option_injection() {
        for url in [
            "file:///tmp/repo",
            "ext::sh -c x",
            "https://token@host/repo",
            "ssh://git:secret@host/repo",
            "git@-host:repo",
            "ssh://-user@host/repo",
            "ssh://host/repo\n",
        ] {
            assert!(parse_url(url).is_err(), "{url}");
        }
        assert_eq!(
            parse_url("git@example.com:team/repo.git").unwrap().name,
            "repo"
        );
        assert!(parse_url("ssh://git@example.com:2222/team/repo").is_ok());
        assert!(validate_branch(Some("--upload-pack=x")).is_err());
        assert!(validate_branch(Some("a..b")).is_err());
        assert!(validate_branch(Some("feature/a")).is_ok());
    }
    #[tokio::test]
    async fn reserve_never_reuses_empty_or_populated_directories() {
        let temporary = tempfile::tempdir().unwrap();
        let remote = parse_url("git@example.com:team/repo.git").unwrap();
        let first = reserve_directory(temporary.path(), &remote, None)
            .await
            .unwrap();
        let second = reserve_directory(temporary.path(), &remote, None)
            .await
            .unwrap();
        assert_ne!(first, second);
        assert!(
            reserve_directory(temporary.path(), &remote, first.to_str())
                .await
                .is_err()
        );
        tokio::fs::write(first.join("keep.txt"), "keep")
            .await
            .unwrap();
        assert!(
            reserve_directory(temporary.path(), &remote, first.to_str())
                .await
                .is_err()
        );
        assert!(first.join("keep.txt").exists());
        for invalid in ["CON", "nul.txt", "repo.", "repo:stream"] {
            assert!(validate_child(invalid).is_err());
        }
    }
}
