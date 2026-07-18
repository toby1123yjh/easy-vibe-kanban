use std::{collections::HashSet, path::Path, process::Stdio, time::Duration};

use agent_client_protocol as proto;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines},
    process::Command,
};
use workspace_utils::command_ext::GroupSpawnNoWindowExt;

use crate::{
    command::{CmdOverrides, CommandParts},
    env::{ExecutionEnv, RepoContext},
    executors::ExecutorError,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::executors) struct AcpDiscoveredModel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::executors) struct AcpModelCatalog {
    pub models: Vec<AcpDiscoveredModel>,
    pub current_model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionResult {
    #[serde(default)]
    models: Option<SessionModelState>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionModelState {
    #[serde(default, alias = "current_model_id")]
    current_model_id: Option<String>,
    #[serde(default, alias = "available_models")]
    available_models: Vec<SessionModel>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionModel {
    #[serde(alias = "model_id")]
    model_id: String,
    #[serde(default)]
    name: Option<String>,
}

pub(in crate::executors) async fn discover_model_catalog(
    command_parts: CommandParts,
    cmd_overrides: &CmdOverrides,
    timeout: Duration,
) -> Result<AcpModelCatalog, ExecutorError> {
    let (program_path, args) = command_parts.into_resolved().await?;
    let temp_dir = tempfile::Builder::new()
        .prefix("vibe-kanban-acp-discovery-")
        .tempdir()
        .map_err(ExecutorError::Io)?;
    let cwd = temp_dir.path().to_path_buf();

    let mut command = Command::new(program_path);
    command
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .current_dir(&cwd)
        .env("NPM_CONFIG_LOGLEVEL", "error")
        .env("NODE_NO_WARNINGS", "1")
        .env("NO_COLOR", "1")
        .args(args);

    ExecutionEnv::new(RepoContext::default(), false, String::new())
        .with_profile(cmd_overrides)
        .apply_to_command(&mut command);

    let mut child = command.group_spawn_no_window()?;
    let stdin = child.inner().stdin.take().ok_or_else(|| {
        ExecutorError::Io(std::io::Error::other(
            "ACP discovery child process has no stdin",
        ))
    })?;
    let stdout = child.inner().stdout.take().ok_or_else(|| {
        ExecutorError::Io(std::io::Error::other(
            "ACP discovery child process has no stdout",
        ))
    })?;

    let discovery = perform_discovery(stdin, stdout, &cwd);
    let result = tokio::time::timeout(timeout, discovery).await;

    let _ = child.kill().await;
    let _ = child.wait().await;

    match result {
        Ok(result) => result,
        Err(_) => Err(ExecutorError::Io(std::io::Error::other(
            "Timed out discovering ACP models",
        ))),
    }
}

async fn perform_discovery<W, R>(
    mut stdin: W,
    stdout: R,
    cwd: &Path,
) -> Result<AcpModelCatalog, ExecutorError>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(stdout).lines();
    let initialize_params =
        serde_json::to_value(proto::InitializeRequest::new(proto::ProtocolVersion::V1))?;
    rpc_request(&mut stdin, &mut lines, 0, "initialize", initialize_params).await?;

    let session_params = serde_json::to_value(proto::NewSessionRequest::new(cwd))?;
    let result = rpc_request(&mut stdin, &mut lines, 1, "session/new", session_params).await?;

    parse_model_catalog(result)
}

async fn rpc_request<W, R>(
    stdin: &mut W,
    lines: &mut Lines<BufReader<R>>,
    id: i64,
    method: &str,
    params: Value,
) -> Result<Value, ExecutorError>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
{
    write_message(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }),
    )
    .await?;

    loop {
        let line = lines.next_line().await.map_err(ExecutorError::Io)?;
        let Some(line) = line else {
            return Err(ExecutorError::Io(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                format!("ACP process exited before responding to {method}"),
            )));
        };

        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            tracing::debug!(?line, "Ignoring non-JSON ACP discovery output");
            continue;
        };

        if message.get("method").is_some() {
            if let Some(request_id) = message.get("id") {
                write_message(
                    stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {
                            "code": -32601,
                            "message": "Method not available during model discovery",
                        },
                    }),
                )
                .await?;
            }
            continue;
        }

        if message.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }

        if let Some(error) = message.get("error") {
            return Err(ExecutorError::Io(std::io::Error::other(format!(
                "ACP {method} failed: {error}"
            ))));
        }

        return message.get("result").cloned().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other(format!(
                "ACP {method} response did not contain a result"
            )))
        });
    }
}

async fn write_message<W>(stdin: &mut W, message: &Value) -> Result<(), ExecutorError>
where
    W: AsyncWrite + Unpin,
{
    let mut bytes = serde_json::to_vec(message)?;
    if cfg!(windows) {
        bytes.extend_from_slice(b"\r\n");
    } else {
        bytes.push(b'\n');
    }
    stdin.write_all(&bytes).await.map_err(ExecutorError::Io)?;
    stdin.flush().await.map_err(ExecutorError::Io)
}

fn parse_model_catalog(result: Value) -> Result<AcpModelCatalog, ExecutorError> {
    let result: NewSessionResult = serde_json::from_value(result)?;
    let Some(state) = result.models else {
        return Ok(AcpModelCatalog {
            models: Vec::new(),
            current_model_id: None,
        });
    };

    let mut seen = HashSet::new();
    let models = state
        .available_models
        .into_iter()
        .filter(|model| !model.model_id.trim().is_empty())
        .filter(|model| seen.insert(model.model_id.clone()))
        .map(|model| {
            let name = model
                .name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty() && !name.eq_ignore_ascii_case("unknown"))
                .map(str::to_string)
                .unwrap_or_else(|| model.model_id.clone());
            AcpDiscoveredModel {
                id: model.model_id,
                name,
            }
        })
        .collect();

    let current_model_id = state
        .current_model_id
        .filter(|model_id| !model_id.trim().is_empty());

    Ok(AcpModelCatalog {
        models,
        current_model_id,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    use super::{parse_model_catalog, perform_discovery};

    #[tokio::test]
    async fn performs_initialize_then_session_new_handshake() {
        let (client, server) = tokio::io::duplex(16 * 1024);
        let (client_reader, client_writer) = tokio::io::split(client);
        let (server_reader, mut server_writer) = tokio::io::split(server);

        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let initialize: serde_json::Value = serde_json::from_str(
                &lines
                    .next_line()
                    .await
                    .expect("initialize read should succeed")
                    .expect("initialize request should be present"),
            )
            .expect("initialize request should be JSON");
            assert_eq!(initialize["method"], "initialize");
            assert_eq!(initialize["params"]["protocolVersion"], 1);
            server_writer
                .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{}}\n")
                .await
                .expect("initialize response should write");

            let new_session: serde_json::Value = serde_json::from_str(
                &lines
                    .next_line()
                    .await
                    .expect("session/new read should succeed")
                    .expect("session/new request should be present"),
            )
            .expect("session/new request should be JSON");
            assert_eq!(new_session["method"], "session/new");
            assert!(new_session["params"]["cwd"].is_string());
            server_writer
                .write_all(
                    b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"sessionId\":\"session-1\",\"models\":{\"currentModelId\":\"gpt-5\",\"availableModels\":[{\"modelId\":\"gpt-5\",\"name\":\"GPT-5\"}]}}}\n",
                )
                .await
                .expect("session/new response should write");
        });

        let catalog = perform_discovery(client_writer, client_reader, &std::env::temp_dir())
            .await
            .expect("ACP handshake should discover models");
        server_task.await.expect("fake ACP server should finish");

        assert_eq!(catalog.current_model_id.as_deref(), Some("gpt-5"));
        assert_eq!(catalog.models[0].id, "gpt-5");
    }

    #[test]
    fn parses_camel_case_model_state_and_preserves_ids() {
        let catalog = parse_model_catalog(json!({
            "sessionId": "session-1",
            "models": {
                "currentModelId": "provider:model/1.0",
                "availableModels": [
                    {"modelId": "provider:model/1.0", "name": "Model One"},
                    {"modelId": "provider:model/1.0", "name": "Duplicate"},
                    {"modelId": "claude-sonnet-4.6", "name": "Unknown"},
                    {"modelId": "gpt/next:preview", "name": "   "}
                ]
            }
        }))
        .expect("catalog should parse");

        assert_eq!(
            catalog.current_model_id.as_deref(),
            Some("provider:model/1.0")
        );
        assert_eq!(catalog.models.len(), 3);
        assert_eq!(catalog.models[0].id, "provider:model/1.0");
        assert_eq!(catalog.models[0].name, "Model One");
        assert_eq!(catalog.models[1].id, "claude-sonnet-4.6");
        assert_eq!(catalog.models[1].name, "claude-sonnet-4.6");
        assert_eq!(catalog.models[2].id, "gpt/next:preview");
        assert_eq!(catalog.models[2].name, "gpt/next:preview");
    }

    #[test]
    fn parses_snake_case_model_state() {
        let catalog = parse_model_catalog(json!({
            "session_id": "session-1",
            "models": {
                "current_model_id": "gpt-5",
                "available_models": [
                    {"model_id": "gpt-5", "name": "GPT-5"}
                ]
            }
        }))
        .expect("catalog should parse");

        assert_eq!(catalog.current_model_id.as_deref(), Some("gpt-5"));
        assert_eq!(catalog.models[0].id, "gpt-5");
        assert_eq!(catalog.models[0].name, "GPT-5");
    }

    #[test]
    fn missing_or_empty_model_state_stays_empty() {
        let missing = parse_model_catalog(json!({"sessionId": "session-1"}))
            .expect("missing models should be tolerated");
        let empty = parse_model_catalog(json!({
            "sessionId": "session-1",
            "models": {
                "currentModelId": "",
                "availableModels": []
            }
        }))
        .expect("empty models should be tolerated");

        assert!(missing.models.is_empty());
        assert!(missing.current_model_id.is_none());
        assert!(empty.models.is_empty());
        assert!(empty.current_model_id.is_none());
    }
}
