//! A one-use, execution-local proof that the provider really requested the
//! bundled MCP's actual tools/list. No proof, token, or challenge enters a native
//! protocol frame, persisted launch record, configuration file, or diagnostic.
use std::{
    fmt,
    future::Future,
    net::{Ipv4Addr, SocketAddr},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{OnceCell, oneshot},
    task::JoinHandle,
    time::Instant,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    AGENT_RUN_ID_ENV, READY_ADDRESS_ENV, SESSION_ID_ENV, ScopedWorkflowMcp, TOKEN_ENV, TURN_ID_ENV,
    WORKFLOW_TOOL_NAMES, launch_error, valid_token,
};
use crate::{
    env::ExecutionEnv,
    executors::{ExecutorControl, ExecutorError, provider_adapter::DirectControl},
};

const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 4096;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
type ReadyResult<T = ()> = Result<T, &'static str>;

#[derive(Clone)]
struct Scope {
    session_id: Uuid,
    agent_run_id: Uuid,
    turn_id: Uuid,
    token: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Challenge {
    protocol_version: u32,
    nonce: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Proof {
    protocol_version: u32,
    session_id: Uuid,
    agent_run_id: Uuid,
    turn_id: Uuid,
    application_version: String,
    tools: Vec<String>,
    proof: String,
}

/// The listener starts immediately, before any provider session request. Some
/// providers await MCP tools/list inside session/new or thread/start; waiting to
/// accept until after that response would deadlock their startup.
pub struct WorkflowMcpReadiness {
    completion: oneshot::Receiver<ReadyResult>,
    listener_task: JoinHandle<()>,
    startup_deadline: Instant,
}

impl fmt::Debug for WorkflowMcpReadiness {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowMcpReadiness")
            .finish_non_exhaustive()
    }
}

impl Drop for WorkflowMcpReadiness {
    fn drop(&mut self) {
        self.listener_task.abort();
    }
}

impl WorkflowMcpReadiness {
    pub async fn start(env: &mut ExecutionEnv) -> Result<Option<Self>, ExecutorError> {
        Self::start_with_timeout(env, STARTUP_TIMEOUT).await
    }

    async fn start_with_timeout(
        env: &mut ExecutionEnv,
        timeout: Duration,
    ) -> Result<Option<Self>, ExecutorError> {
        if ScopedWorkflowMcp::from_execution_env(env)?.is_none() {
            return Ok(None);
        }
        let parse_id = |key| {
            env.get(key)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| launch_error("Workflow MCP execution identity is invalid"))
        };
        let scope = Scope {
            session_id: parse_id(SESSION_ID_ENV)?,
            agent_run_id: parse_id(AGENT_RUN_ID_ENV)?,
            turn_id: parse_id(TURN_ID_ENV)?,
            token: env
                .get(TOKEN_ENV)
                .cloned()
                .ok_or_else(|| launch_error("Workflow MCP scoped credential is missing"))?,
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| launch_error("Workflow MCP readiness listener is unavailable"))?;
        let address = listener
            .local_addr()
            .map_err(|_| launch_error("Workflow MCP readiness listener is unavailable"))?;
        env.insert(READY_ADDRESS_ENV, address.to_string());
        let startup_deadline = Instant::now() + timeout;
        let (completion_tx, completion) = oneshot::channel();
        let listener_task = tokio::spawn(async move {
            let result = tokio::time::timeout_at(startup_deadline, accept_once(listener, scope))
                .await
                .unwrap_or(Err(
                    "Workflow MCP tools were not loaded before the startup timeout",
                ));
            let _ = completion_tx.send(result);
        });
        Ok(Some(Self {
            completion,
            listener_task,
            startup_deadline,
        }))
    }

    pub fn startup_deadline(&self) -> Instant {
        self.startup_deadline
    }

    /// Bound only native initialization/session creation, never a running Agent
    /// or the response to its real prompt. A tools/list timeout must also fail a
    /// provider that is stuck awaiting its own initialization response.
    pub async fn bound_startup<T>(
        deadline: Option<Instant>,
        cancel: &CancellationToken,
        future: impl Future<Output = T>,
    ) -> Result<T, ExecutorError> {
        let Some(deadline) = deadline else {
            return Ok(future.await);
        };
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(launch_error("Workflow MCP startup was cancelled")),
            _ = tokio::time::sleep_until(deadline) => {
                cancel.cancel();
                Err(launch_error("Workflow MCP native startup exceeded the startup timeout"))
            },
            output = future => Ok(output),
        }
    }

    pub async fn wait(mut self, cancel: &CancellationToken) -> Result<(), ExecutorError> {
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err("Workflow MCP startup was cancelled"),
            result = &mut self.completion => result.unwrap_or(Err("Workflow MCP readiness listener stopped")),
        };
        result.map_err(launch_error)
    }

    pub async fn wait_optional(
        readiness: Option<Self>,
        cancel: &CancellationToken,
    ) -> Result<(), ExecutorError> {
        if let Some(readiness) = readiness {
            readiness.wait(cancel).await?;
        }
        Ok(())
    }
}

async fn accept_once(listener: TcpListener, scope: Scope) -> ReadyResult {
    let (mut stream, peer) = listener
        .accept()
        .await
        .map_err(|_| "Workflow MCP readiness connection failed")?;
    if peer.ip() != Ipv4Addr::LOCALHOST {
        return Err("Workflow MCP readiness connection is not local");
    }
    let challenge = Challenge {
        protocol_version: PROTOCOL_VERSION,
        nonce: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
    };
    write_frame(&mut stream, &challenge).await?;
    let proof: Proof = read_frame(&mut stream).await?;
    if proof.protocol_version != PROTOCOL_VERSION
        || proof.session_id != scope.session_id
        || proof.agent_run_id != scope.agent_run_id
        || proof.turn_id != scope.turn_id
        || proof.application_version != env!("CARGO_PKG_VERSION")
        || !exact_tools(&proof.tools)
        || !constant_time_equal(
            proof.proof.as_bytes(),
            calculate_proof(&scope, &challenge, &proof).as_bytes(),
        )
    {
        return Err("Workflow MCP tool discovery did not match this execution and version");
    }
    // Acknowledgement is non-sensitive; the MCP callback fails closed unless
    // the execution that owns this one-use listener accepted its proof.
    stream
        .write_u8(1)
        .await
        .map_err(|_| "Workflow MCP readiness acknowledgement failed")?;
    Ok(())
}

/// Held only by the MCP process, with immutable launch scope. Repeat tools/list
/// calls do not reconnect to or reuse an already consumed listener.
pub struct WorkflowMcpReadyReporter {
    address: SocketAddr,
    scope: Scope,
    reported: OnceCell<ReadyResult>,
}

impl fmt::Debug for WorkflowMcpReadyReporter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowMcpReadyReporter")
            .finish_non_exhaustive()
    }
}

impl WorkflowMcpReadyReporter {
    pub fn new(
        address: &str,
        session_id: Uuid,
        agent_run_id: Uuid,
        turn_id: Uuid,
        token: String,
    ) -> Result<Self, std::io::Error> {
        let address = address
            .parse::<SocketAddr>()
            .ok()
            .filter(|address| address.ip() == Ipv4Addr::LOCALHOST && address.port() != 0)
            .ok_or_else(|| std::io::Error::other("Invalid workflow MCP readiness address"))?;
        if !valid_token(&token) {
            return Err(std::io::Error::other(
                "Invalid workflow MCP readiness credential",
            ));
        }
        Ok(Self {
            address,
            scope: Scope {
                session_id,
                agent_run_id,
                turn_id,
                token,
            },
            reported: OnceCell::new(),
        })
    }

    pub async fn report_listed_tools(&self, tools: Vec<String>) -> Result<(), std::io::Error> {
        if !exact_tools(&tools) {
            return Err(std::io::Error::other(
                "Workflow MCP tool discovery must contain exactly the six scoped tools",
            ));
        }
        self.reported
            .get_or_init(|| async {
                tokio::time::timeout(STARTUP_TIMEOUT, self.report(tools))
                    .await
                    .unwrap_or(Err("Workflow MCP readiness acknowledgement timed out"))
            })
            .await
            .map_err(std::io::Error::other)
    }

    async fn report(&self, tools: Vec<String>) -> ReadyResult {
        if !exact_tools(&tools) {
            return Err("Workflow MCP tool discovery must contain exactly the six scoped tools");
        }
        let mut stream = TcpStream::connect(self.address)
            .await
            .map_err(|_| "Workflow MCP readiness listener is unavailable")?;
        let challenge: Challenge = read_frame(&mut stream).await?;
        if challenge.protocol_version != PROTOCOL_VERSION
            || challenge.nonce.len() != 64
            || !valid_token(&challenge.nonce)
        {
            return Err("Workflow MCP readiness challenge is invalid");
        }
        let proof = make_proof(&self.scope, &challenge, tools);
        write_frame(&mut stream, &proof).await?;
        if stream
            .read_u8()
            .await
            .map_err(|_| "Workflow MCP readiness proof was rejected")?
            != 1
        {
            return Err("Workflow MCP readiness proof was rejected");
        }
        Ok(())
    }
}

fn exact_tools(tools: &[String]) -> bool {
    let mut actual = tools.iter().map(String::as_str).collect::<Vec<_>>();
    let mut expected = WORKFLOW_TOOL_NAMES;
    actual.sort_unstable();
    expected.sort_unstable();
    actual == expected
}

fn make_proof(scope: &Scope, challenge: &Challenge, tools: Vec<String>) -> Proof {
    let mut proof = Proof {
        protocol_version: PROTOCOL_VERSION,
        session_id: scope.session_id,
        agent_run_id: scope.agent_run_id,
        turn_id: scope.turn_id,
        application_version: env!("CARGO_PKG_VERSION").to_owned(),
        tools,
        proof: String::new(),
    };
    proof.proof = calculate_proof(scope, challenge, &proof);
    proof
}

fn calculate_proof(scope: &Scope, challenge: &Challenge, proof: &Proof) -> String {
    // Raw token, not its DB verifier, is required. A fresh listener challenge
    // prevents a captured/DB-replayed proof from authorising another startup.
    let mut digest = Sha256::new();
    digest.update(b"vk-workflow-mcp-ready-v1\0");
    digest.update(proof.protocol_version.to_be_bytes());
    for field in [
        scope.token.as_bytes(),
        challenge.nonce.as_bytes(),
        proof.session_id.as_bytes(),
        proof.agent_run_id.as_bytes(),
        proof.turn_id.as_bytes(),
        proof.application_version.as_bytes(),
    ] {
        digest.update((field.len() as u64).to_be_bytes());
        digest.update(field);
    }
    let mut tools = proof.tools.clone();
    tools.sort_unstable();
    for tool in tools {
        digest.update((tool.len() as u64).to_be_bytes());
        digest.update(tool.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

async fn read_frame<T: DeserializeOwned>(stream: &mut TcpStream) -> ReadyResult<T> {
    let size = stream
        .read_u32()
        .await
        .map_err(|_| "Workflow MCP readiness frame is missing")? as usize;
    if size == 0 || size > MAX_FRAME_BYTES {
        return Err("Workflow MCP readiness frame exceeds its size limit");
    }
    let mut bytes = vec![0; size];
    stream
        .read_exact(&mut bytes)
        .await
        .map_err(|_| "Workflow MCP readiness frame is incomplete")?;
    serde_json::from_slice(&bytes).map_err(|_| "Workflow MCP readiness frame is invalid")
}

async fn write_frame<T: Serialize>(stream: &mut TcpStream, value: &T) -> ReadyResult {
    let bytes = serde_json::to_vec(value).map_err(|_| "Workflow MCP readiness frame is invalid")?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES {
        return Err("Workflow MCP readiness frame exceeds its size limit");
    }
    stream
        .write_u32(bytes.len() as u32)
        .await
        .map_err(|_| "Workflow MCP readiness write failed")?;
    stream
        .write_all(&bytes)
        .await
        .map_err(|_| "Workflow MCP readiness write failed")?;
    Ok(())
}

/// Controls can be exposed for cancellation during startup, but steering may
/// not bypass the first-prompt tool-discovery gate.
#[derive(Debug, Clone)]
pub struct WorkflowPromptGate(Arc<AtomicBool>);

impl WorkflowPromptGate {
    pub fn new(workflow_scoped: bool) -> Self {
        Self(Arc::new(AtomicBool::new(!workflow_scoped)))
    }

    pub fn open(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn wrap(&self, inner: Arc<dyn ExecutorControl>) -> Arc<dyn ExecutorControl> {
        Arc::new(GatedControl {
            gate: self.clone(),
            inner,
        })
    }
}

#[derive(Debug)]
struct GatedControl {
    gate: WorkflowPromptGate,
    inner: Arc<dyn ExecutorControl>,
}

#[async_trait::async_trait]
impl ExecutorControl for GatedControl {
    async fn send(&self, control: DirectControl) -> Result<Vec<u8>, ExecutorError> {
        if matches!(control, DirectControl::Steer { .. }) && !self.gate.0.load(Ordering::Acquire) {
            return Err(launch_error(
                "Workflow MCP tools are not ready; the prompt was not sent",
            ));
        }
        self.inner.send(control).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reporter(env: &ExecutionEnv) -> WorkflowMcpReadyReporter {
        WorkflowMcpReadyReporter::new(
            env.get(READY_ADDRESS_ENV).unwrap(),
            env.get(SESSION_ID_ENV).unwrap().parse().unwrap(),
            env.get(AGENT_RUN_ID_ENV).unwrap().parse().unwrap(),
            env.get(TURN_ID_ENV).unwrap().parse().unwrap(),
            env.get(TOKEN_ENV).unwrap().clone(),
        )
        .unwrap()
    }

    fn tools() -> Vec<String> {
        WORKFLOW_TOOL_NAMES.into_iter().map(str::to_owned).collect()
    }

    #[tokio::test]
    async fn workflow_readiness_proves_actual_tools_before_session_request_returns() {
        let executable = tempfile::NamedTempFile::new().unwrap();
        let mut env = super::super::test_env(executable.path());
        let readiness = WorkflowMcpReadiness::start(&mut env)
            .await
            .unwrap()
            .unwrap();
        let reporter = reporter(&env);
        // Simulate tools/list awaited inside session/new, before adapter.wait.
        reporter.report_listed_tools(tools()).await.unwrap();
        readiness.wait(&CancellationToken::new()).await.unwrap();
        reporter.report_listed_tools(tools()).await.unwrap();
        assert!(
            reporter
                .report_listed_tools(vec!["workflow_context".to_owned()])
                .await
                .is_err()
        );
        assert!(!format!("{reporter:?}").contains(env.get(TOKEN_ENV).unwrap()));
    }

    #[tokio::test]
    async fn workflow_readiness_bounds_hung_native_startup_but_not_ordinary_or_agent_work() {
        let cancel = CancellationToken::new();
        let deadline = Instant::now() + Duration::from_millis(10);
        let result = WorkflowMcpReadiness::bound_startup(
            Some(deadline),
            &cancel,
            std::future::pending::<()>(),
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("timeout"));
        assert!(cancel.is_cancelled());

        // A closed gate fails even if an already-ready future is provided.
        assert!(
            WorkflowMcpReadiness::bound_startup(
                Some(Instant::now() + Duration::from_secs(1)),
                &cancel,
                async { () }
            )
            .await
            .is_err()
        );
        assert_eq!(
            WorkflowMcpReadiness::bound_startup(None, &cancel, async { 42 })
                .await
                .unwrap(),
            42
        );

        let cancel = CancellationToken::new();
        let completed = WorkflowMcpReadiness::bound_startup(
            Some(Instant::now() + Duration::from_secs(1)),
            &cancel,
            async { 7 },
        )
        .await
        .unwrap();
        assert_eq!(completed, 7);
        // Finishing the startup guard does not create a run-duration timer.
        tokio::time::sleep(Duration::from_millis(15)).await;
        assert!(!cancel.is_cancelled());
    }

    #[tokio::test]
    async fn workflow_readiness_rejects_wrong_scope_version_tools_and_proof() {
        for invalid_field in ["session", "run", "turn", "version", "tools", "proof"] {
            let executable = tempfile::NamedTempFile::new().unwrap();
            let mut env = super::super::test_env(executable.path());
            let readiness = WorkflowMcpReadiness::start(&mut env)
                .await
                .unwrap()
                .unwrap();
            let reporter = reporter(&env);
            let mut stream = TcpStream::connect(reporter.address).await.unwrap();
            let challenge: Challenge = read_frame(&mut stream).await.unwrap();
            let mut proof = make_proof(&reporter.scope, &challenge, tools());
            match invalid_field {
                "session" => proof.session_id = Uuid::new_v4(),
                "run" => proof.agent_run_id = Uuid::new_v4(),
                "turn" => proof.turn_id = Uuid::new_v4(),
                "version" => proof.application_version = "other-version".to_owned(),
                "tools" => proof.tools.push("run_session_prompt".to_owned()),
                _ => proof.proof = super::super::token_hash(&reporter.scope.token),
            }
            write_frame(&mut stream, &proof).await.unwrap();
            assert!(
                readiness.wait(&CancellationToken::new()).await.is_err(),
                "{invalid_field}"
            );
        }
    }

    #[test]
    fn workflow_readiness_challenge_prevents_replaying_a_db_verifier_or_old_proof() {
        let scope = Scope {
            session_id: Uuid::new_v4(),
            agent_run_id: Uuid::new_v4(),
            turn_id: Uuid::new_v4(),
            token: "a".repeat(64),
        };
        let first = Challenge {
            protocol_version: PROTOCOL_VERSION,
            nonce: "b".repeat(64),
        };
        let next = Challenge {
            protocol_version: PROTOCOL_VERSION,
            nonce: "c".repeat(64),
        };
        let proof = make_proof(&scope, &first, tools());
        assert_ne!(proof.proof, calculate_proof(&scope, &next, &proof));
        let db_only = Scope {
            token: super::super::token_hash(&scope.token),
            ..scope
        };
        assert_ne!(proof.proof, calculate_proof(&db_only, &first, &proof));
        for address in [
            "0.0.0.0:3001",
            "192.0.2.1:3001",
            "127.0.0.1:0",
            "not-an-address",
        ] {
            assert!(
                WorkflowMcpReadyReporter::new(
                    address,
                    Uuid::nil(),
                    Uuid::nil(),
                    Uuid::nil(),
                    "a".repeat(64)
                )
                .is_err()
            );
        }
    }

    #[tokio::test]
    async fn workflow_readiness_is_bounded_cancelable_and_ordinary_runs_are_unchanged() {
        let mut ordinary = ExecutionEnv::new(Default::default(), false, String::new());
        assert!(
            WorkflowMcpReadiness::start(&mut ordinary)
                .await
                .unwrap()
                .is_none()
        );
        assert!(!ordinary.contains_key(READY_ADDRESS_ENV));
        let executable = tempfile::NamedTempFile::new().unwrap();
        let mut env = super::super::test_env(executable.path());
        let readiness =
            WorkflowMcpReadiness::start_with_timeout(&mut env, Duration::from_millis(10))
                .await
                .unwrap()
                .unwrap();
        assert!(
            readiness
                .wait(&CancellationToken::new())
                .await
                .unwrap_err()
                .to_string()
                .contains("timeout")
        );
        let readiness = WorkflowMcpReadiness::start(&mut env)
            .await
            .unwrap()
            .unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(readiness.wait(&cancel).await.is_err());
        let readiness = WorkflowMcpReadiness::start(&mut env)
            .await
            .unwrap()
            .unwrap();
        let mut stream = TcpStream::connect(env.get(READY_ADDRESS_ENV).unwrap())
            .await
            .unwrap();
        let _: Challenge = read_frame(&mut stream).await.unwrap();
        stream
            .write_u32((MAX_FRAME_BYTES + 1) as u32)
            .await
            .unwrap();
        assert!(readiness.wait(&CancellationToken::new()).await.is_err());
    }

    #[derive(Debug, Default)]
    struct FakeControl(AtomicBool);

    #[async_trait::async_trait]
    impl ExecutorControl for FakeControl {
        async fn send(&self, _: DirectControl) -> Result<Vec<u8>, ExecutorError> {
            self.0.store(true, Ordering::Relaxed);
            Ok(Vec::new())
        }
    }

    #[tokio::test]
    async fn workflow_readiness_gate_blocks_steering_but_not_owned_cancellation() {
        let gate = WorkflowPromptGate::new(true);
        let fake = Arc::new(FakeControl::default());
        let control = gate.wrap(fake.clone());
        assert!(
            control
                .send(DirectControl::Steer {
                    text: "must not run".to_owned()
                })
                .await
                .is_err()
        );
        assert!(!fake.0.load(Ordering::Relaxed));
        control.send(DirectControl::Cancel).await.unwrap();
        gate.open();
        control
            .send(DirectControl::Steer {
                text: "ready".to_owned(),
            })
            .await
            .unwrap();
        WorkflowPromptGate::new(false)
            .wrap(Arc::new(FakeControl::default()))
            .send(DirectControl::Steer {
                text: "ordinary".to_owned(),
            })
            .await
            .unwrap();
    }
}
