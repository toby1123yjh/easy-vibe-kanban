//! Real internal-helper lifecycle tests; synthetic keys and loopback only.
use std::{process::Stdio, time::Duration};

use command_group::AsyncCommandGroup;
use rand::rngs::OsRng;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    process::Command,
};

fn input(port: u16) -> Vec<u8> {
    let key = ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap();
    let key = key.to_openssh(ssh_key::LineEnding::LF).unwrap();
    let mut bytes = serde_json::to_vec(&serde_json::json!({
        "url": format!("ssh://git@127.0.0.1:{port}/synthetic-repo"),
        "branch": null,
        "directory": null,
        "secret": {"private_key": key.as_str(), "password": null}
    }))
    .unwrap();
    bytes.push(b'\n');
    bytes
}

fn worker(directory: &std::path::Path) -> command_group::AsyncGroupChild {
    let mut command = Command::new(env!("CARGO_BIN_EXE_server"));
    command
        .arg("--git-import-worker")
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut group = command.group();
    group.kill_on_drop(true);
    #[cfg(windows)]
    group.creation_flags(0x08000000);
    group.spawn().unwrap()
}

#[tokio::test]
async fn operation_error_exits_even_while_parent_keeps_stdin_open() {
    let temporary = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut child = worker(temporary.path());
    let mut stdin = child.inner().stdin.take().unwrap();
    stdin.write_all(&input(port)).await.unwrap();
    let (socket, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
        .await
        .unwrap()
        .unwrap();
    drop(socket); // Fail an actual SSH handshake, after the parent-death watcher starts.
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("helper must not wait for stdin EOF after its operation completes")
        .unwrap();
    assert!(status.success());
    drop(stdin);
    use tokio::io::AsyncReadExt;
    let mut output = String::new();
    child
        .inner()
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .await
        .unwrap();
    let frames: Vec<serde_json::Value> = output
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let stages: Vec<&str> = frames
        .iter()
        .filter(|frame| frame["kind"] == "stage")
        .map(|frame| frame["value"].as_str().unwrap())
        .collect();
    assert_eq!(
        stages,
        [
            "reading_request",
            "decoding_key",
            "initializing_transport",
            "connecting_ssh"
        ]
    );
    let message = frames.last().unwrap();
    assert_eq!(message["kind"], "error");
    assert!(!output.contains("PRIVATE KEY"));
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn parent_eof_terminates_a_stalled_ssh_handshake() {
    let temporary = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut child = worker(temporary.path());
    let mut stdin = child.inner().stdin.take().unwrap();
    let mut stdout = BufReader::new(child.inner().stdout.take().unwrap()).lines();
    stdin
        .write_all(&input(listener.local_addr().unwrap().port()))
        .await
        .unwrap();
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
        .await
        .unwrap()
        .unwrap();
    assert!(child.try_wait().unwrap().is_none());
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let line = stdout.next_line().await.unwrap().unwrap();
            let frame: serde_json::Value = serde_json::from_str(&line).unwrap();
            if frame["kind"] == "stage" && frame["value"] == "connecting_ssh" {
                break;
            }
        }
    })
    .await
    .expect("the parent must receive the SSH stage before a stalled handshake exits");
    drop(stdin);
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("parent EOF must terminate blocked libssh2")
        .unwrap();
    assert_eq!(status.code(), Some(3));
}

#[tokio::test]
async fn group_cancellation_reaps_a_stalled_ssh_writer() {
    let temporary = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut child = worker(temporary.path());
    let mut stdin = child.inner().stdin.take().unwrap();
    stdin
        .write_all(&input(listener.local_addr().unwrap().port()))
        .await
        .unwrap();
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
        .await
        .unwrap()
        .unwrap();
    assert!(child.try_wait().unwrap().is_none());
    tokio::time::timeout(
        Duration::from_secs(20),
        utils::process::kill_process_group(&mut child),
    )
    .await
    .expect("group cancellation must be bounded")
    .unwrap();
    assert!(child.try_wait().unwrap().is_some());
    drop(stdin);
}
