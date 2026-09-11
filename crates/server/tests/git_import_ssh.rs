//! Actual helper + SSH + Git protocol regressions. Every key/repository/trust
//! file is synthetic; only loopback is used and the real user's home is untouched.
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use base64::Engine;
use command_group::AsyncCommandGroup;
use hmac::{Hmac, Mac};
use russh::{Channel, ChannelId, server};
use sha1::Sha1;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    process::Command,
};

struct GitServer {
    identity: ssh_key::PublicKey,
    repository: PathBuf,
    offered: Arc<AtomicUsize>,
    authenticated: Arc<AtomicUsize>,
    channel: Option<Channel<server::Msg>>,
}

#[async_trait]
impl server::Handler for GitServer {
    type Error = russh::Error;

    async fn auth_publickey_offered(
        &mut self,
        user: &str,
        key: &ssh_key::PublicKey,
    ) -> Result<server::Auth, Self::Error> {
        self.offered.fetch_add(1, Ordering::SeqCst);
        Ok(
            if user == "git" && key.key_data() == self.identity.key_data() {
                server::Auth::Accept
            } else {
                server::Auth::Reject {
                    proceed_with_methods: None,
                }
            },
        )
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        key: &ssh_key::PublicKey,
    ) -> Result<server::Auth, Self::Error> {
        assert_eq!(user, "git");
        assert_eq!(key.key_data(), self.identity.key_data());
        // This callback runs only after the SSH signature has been verified.
        self.authenticated.fetch_add(1, Ordering::SeqCst);
        Ok(server::Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<server::Msg>,
        _: &mut server::Session,
    ) -> Result<bool, Self::Error> {
        self.channel = Some(channel);
        Ok(true)
    }

    async fn exec_request(
        &mut self,
        id: ChannelId,
        command: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        assert_eq!(command, b"git-upload-pack '/synthetic-repo'");
        session.channel_success(id)?;
        let stream = self.channel.take().unwrap().into_stream();
        let repository = self.repository.clone();
        let handle = session.handle();
        tokio::spawn(async move {
            // The supplied SSH command is asserted, never executed as a shell.
            let mut child = Command::new("git")
                .arg("upload-pack")
                .arg(repository)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let mut input = child.stdin.take().unwrap();
            let mut output = child.stdout.take().unwrap();
            let (mut incoming, mut outgoing) = tokio::io::split(stream);
            let input_pump = tokio::spawn(async move {
                let _ = tokio::io::copy(&mut incoming, &mut input).await;
                let _ = input.shutdown().await;
            });
            let _ = tokio::io::copy(&mut output, &mut outgoing).await;
            let status = child.wait().await.unwrap();
            let _ = handle
                .exit_status_request(id, status.code().unwrap_or(1) as u32)
                .await;
            let _ = handle.eof(id).await;
            let _ = handle.close(id).await;
            input_pump.abort();
        });
        Ok(())
    }
}

fn new_key() -> ssh_key::PrivateKey {
    ssh_key::PrivateKey::random(&mut rand::rngs::OsRng, ssh_key::Algorithm::Ed25519).unwrap()
}

fn repository(path: &Path) -> git2::Oid {
    let repo = git2::Repository::init_bare(path).unwrap();
    let blob = repo.blob(b"real SSH and Git checkout\n").unwrap();
    // This fixture must not depend on the developer's global core.autocrlf.
    let attributes = repo.blob(b"* -text\n").unwrap();
    let mut tree = repo.treebuilder(None).unwrap();
    tree.insert("verified.txt", blob, 0o100644).unwrap();
    tree.insert(".gitattributes", attributes, 0o100644).unwrap();
    let tree = repo.find_tree(tree.write().unwrap()).unwrap();
    let signature = git2::Signature::now("Synthetic Git Import", "test@example.invalid").unwrap();
    let commit = repo
        .commit(
            Some("refs/heads/main"),
            &signature,
            &signature,
            "fixture",
            &tree,
            &[],
        )
        .unwrap();
    repo.set_head("refs/heads/main").unwrap();
    commit
}

async fn serve(
    key: ssh_key::PrivateKey,
    identity: ssh_key::PublicKey,
    repository: PathBuf,
) -> (
    u16,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let offered = Arc::new(AtomicUsize::new(0));
    let authenticated = Arc::new(AtomicUsize::new(0));
    let handler = GitServer {
        identity,
        repository,
        offered: offered.clone(),
        authenticated: authenticated.clone(),
        channel: None,
    };
    let config = Arc::new(server::Config {
        keys: vec![key],
        auth_rejection_time: Duration::ZERO,
        auth_rejection_time_initial: Some(Duration::ZERO),
        inactivity_timeout: Some(Duration::from_secs(20)),
        ..Default::default()
    });
    let task = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        // Trust-rejection tests intentionally disconnect during the handshake.
        if let Ok(session) = server::run_stream(config, socket, handler).await {
            let _ = session.await;
        }
    });
    (port, offered, authenticated, task)
}

fn trust(directory: &Path, port: u16, key: &ssh_key::PublicKey, revoked: bool) {
    trust_host(directory, "127.0.0.1", port, key, revoked);
}

fn trust_host(directory: &Path, host: &str, port: u16, key: &ssh_key::PublicKey, revoked: bool) {
    let authority = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    let salt = b"synthetic-test-known-host-salt";
    let hash = Hmac::<Sha1>::new_from_slice(salt)
        .unwrap()
        .chain_update(authority)
        .finalize()
        .into_bytes();
    let encoder = base64::engine::general_purpose::STANDARD;
    let host = format!("|1|{}|{}", encoder.encode(salt), encoder.encode(hash));
    let entry = format!("{host} {}\n", key.to_openssh().unwrap());
    std::fs::create_dir_all(directory.join(".ssh")).unwrap();
    let content = if revoked {
        format!("{entry}@revoked {entry}")
    } else {
        entry
    };
    std::fs::write(directory.join(".ssh/known_hosts"), content).unwrap();
}

async fn run_worker(
    directory: &Path,
    port: u16,
    identity: &ssh_key::PrivateKey,
    clone_path: Option<&Path>,
) -> Vec<serde_json::Value> {
    run_worker_at(
        directory,
        &format!("ssh://git@127.0.0.1:{port}/synthetic-repo"),
        identity,
        clone_path,
        None,
    )
    .await
}

async fn run_worker_at(
    directory: &Path,
    url: &str,
    identity: &ssh_key::PrivateKey,
    clone_path: Option<&Path>,
    proxy: Option<u16>,
) -> Vec<serde_json::Value> {
    let mut command = Command::new(env!("CARGO_BIN_EXE_server"));
    command
        .arg("--git-import-worker")
        .current_dir(directory)
        // Isolate only this child's standard home lookup; do not mutate the
        // test process environment or read/write the developer's trust store.
        .env("HOME", directory)
        .env("USERPROFILE", directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(port) = proxy {
        // Only the isolated worker sees these synthetic proxy settings. Never
        // alter process-global env (tests run concurrently) or the host registry.
        for name in [
            "HTTPS_PROXY",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
            "HTTP_PROXY",
            "http_proxy",
            "NO_PROXY",
            "no_proxy",
        ] {
            command.env_remove(name);
        }
        command
            .env("HTTPS_PROXY", format!("http://127.0.0.1:{port}"))
            .env("NO_PROXY", "");
    }
    let mut group = command.group();
    group.kill_on_drop(true);
    #[cfg(windows)]
    group.creation_flags(0x08000000);
    let mut child = group.spawn().unwrap();
    let mut stdin = child.inner().stdin.take().unwrap();
    let mut stdout = child.inner().stdout.take().unwrap();
    let mut stderr = child.inner().stderr.take().unwrap();
    let output = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).await.unwrap();
        bytes
    });
    let errors = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).await.unwrap();
        bytes
    });
    let key = identity.to_openssh(ssh_key::LineEnding::LF).unwrap();
    let mut input = zeroize::Zeroizing::new(
        serde_json::to_vec(&serde_json::json!({
            "url": url,
            "branch": clone_path.map(|_| "main"), "directory": clone_path,
            "secret": { "private_key": key.as_str(), "password": null }
        }))
        .unwrap(),
    );
    input.push(b'\n');
    stdin.write_all(&input).await.unwrap();
    let status = match tokio::time::timeout(Duration::from_secs(20), child.wait()).await {
        Ok(status) => status.unwrap(),
        Err(_) => {
            utils::process::kill_process_group(&mut child)
                .await
                .unwrap();
            panic!("SSH worker failed to finish within its test deadline");
        }
    };
    assert!(status.success(), "helper process failed: {status}");
    drop(stdin);
    let output = String::from_utf8(output.await.unwrap()).unwrap();
    let errors = String::from_utf8(errors.await.unwrap()).unwrap();
    assert!(!output.contains("PRIVATE KEY"));
    assert!(!output.contains(key.as_str()));
    assert!(!errors.contains(key.as_str()));
    output
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

async fn serve_proxy(
    host: &str,
    ssh_port: u16,
    close_default_endpoint: bool,
) -> (u16, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let host = host.to_string();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let observed = requests.clone();
    let task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(socket.read_u8().await.unwrap());
                assert!(request.len() <= 16 * 1024);
            }
            let request = String::from_utf8(request).unwrap();
            let target = request.split_whitespace().nth(1).unwrap().to_string();
            observed.lock().unwrap().push(target.clone());
            if target != format!("{host}:22")
                && !(host == "github.com" && target == "ssh.github.com:443")
            {
                socket
                    .write_all(b"HTTP/1.1 403 Unknown synthetic target\r\n\r\n")
                    .await
                    .unwrap();
                continue;
            }
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            if close_default_endpoint && target == format!("{host}:22") {
                // Reproduce a proxy which establishes TCP, then drops port22
                // after the client SSH identification (before any auth/key).
                let mut banner = Vec::new();
                while !banner.ends_with(b"\n") {
                    banner.push(socket.read_u8().await.unwrap());
                    assert!(banner.len() <= 255);
                }
                assert!(banner.starts_with(b"SSH-2.0-"));
                continue;
            }
            // Never resolve/connect to the named public hostname: every tunnel
            // maps to this test's loopback SSH fixture, even GitHub fallback.
            let mut upstream = TcpStream::connect(("127.0.0.1", ssh_port)).await.unwrap();
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut upstream).await;
        }
    });
    (port, requests, task)
}

#[tokio::test]
async fn helper_uses_proxy_and_github443_without_changing_origin_trust_or_identity() {
    let directory = tempfile::tempdir().unwrap();
    let identity = new_key();
    let source = directory.path().join("source.git");
    let expected = repository(&source);
    for (host, fallback) in [("git.example.invalid", false), ("github.com", true)] {
        let child_home = directory.path().join(host);
        std::fs::create_dir(&child_home).unwrap();
        let host_key = new_key();
        let (ssh_port, offered, authenticated, server) = serve(
            host_key.clone(),
            identity.public_key().clone(),
            source.clone(),
        )
        .await;
        // There deliberately is no ssh.github.com trust entry. A fallback
        // must use the original github.com identity and host trust binding.
        trust_host(&child_home, host, 22, host_key.public_key(), false);
        let (proxy_port, requests, proxy) = serve_proxy(host, ssh_port, fallback).await;
        let destination = child_home.join("download");
        std::fs::create_dir(&destination).unwrap();
        let url = format!("ssh://git@{host}/synthetic-repo");
        let frames = run_worker_at(
            &child_home,
            &url,
            &identity,
            Some(&destination),
            Some(proxy_port),
        )
        .await;
        let result = frames.last().unwrap();
        assert_eq!(result["kind"], "complete", "{host}: {result}");
        let repo = git2::Repository::open(&destination).unwrap();
        assert_eq!(repo.head().unwrap().target(), Some(expected));
        assert_eq!(
            repo.find_remote("origin").unwrap().url(),
            Some(url.as_str())
        );
        assert_eq!(
            std::fs::read(destination.join("verified.txt")).unwrap(),
            b"real SSH and Git checkout\n"
        );
        assert_eq!(offered.load(Ordering::SeqCst), 1);
        assert_eq!(authenticated.load(Ordering::SeqCst), 1);
        let expected_targets = if fallback {
            vec![
                "github.com:22".to_string(),
                "ssh.github.com:443".to_string(),
            ]
        } else {
            vec![format!("{host}:22")]
        };
        assert_eq!(*requests.lock().unwrap(), expected_targets);
        proxy.abort();
        let _ = proxy.await;
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn helper_proxy_does_not_retry_host_or_auth_failures_or_bypass_fallback_host_trust() {
    let directory = tempfile::tempdir().unwrap();
    let identity = new_key();
    for condition in ["host_key", "wrong_identity", "fallback_host_key"] {
        let child_home = directory.path().join(condition);
        std::fs::create_dir(&child_home).unwrap();
        let host_key = new_key();
        let (ssh_port, offered, authenticated, server) = serve(
            host_key.clone(),
            identity.public_key().clone(),
            child_home.clone(),
        )
        .await;
        let supplied = if condition == "wrong_identity" {
            trust_host(&child_home, "github.com", 22, host_key.public_key(), false);
            new_key()
        } else {
            // Even when the alternate host has a matching entry, an unknown
            // original host must be rejected without offering an identity.
            trust_host(
                &child_home,
                "ssh.github.com",
                443,
                host_key.public_key(),
                false,
            );
            identity.clone()
        };
        let fallback = condition == "fallback_host_key";
        let (proxy_port, requests, proxy) = serve_proxy("github.com", ssh_port, fallback).await;
        let frames = run_worker_at(
            &child_home,
            "ssh://git@github.com/synthetic-repo",
            &supplied,
            None,
            Some(proxy_port),
        )
        .await;
        let result = frames.last().unwrap();
        assert_eq!(result["kind"], "error", "{condition}: {result}");
        assert!(
            result["message"]
                .as_str()
                .unwrap()
                .contains(if condition == "wrong_identity" {
                    "SSH key authentication failed"
                } else {
                    "SSH host key"
                }),
            "{condition}: {result}"
        );
        assert_eq!(
            offered.load(Ordering::SeqCst),
            usize::from(condition == "wrong_identity")
        );
        assert_eq!(authenticated.load(Ordering::SeqCst), 0);
        let expected_targets = if fallback {
            vec!["github.com:22", "ssh.github.com:443"]
        } else {
            vec!["github.com:22"]
        };
        assert_eq!(*requests.lock().unwrap(), expected_targets);
        proxy.abort();
        let _ = proxy.await;
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn helper_authenticates_ed25519_lists_refs_and_clones_with_real_origin() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("source.git");
    let expected = repository(&path);
    let identity = new_key();
    for clone in [false, true] {
        let host_key = new_key();
        let (port, offered, authenticated, server) = serve(
            host_key.clone(),
            identity.public_key().clone(),
            path.clone(),
        )
        .await;
        trust(directory.path(), port, host_key.public_key(), false);
        let destination = directory.path().join("download");
        if clone {
            std::fs::create_dir(&destination).unwrap();
        }
        let frames = run_worker(
            directory.path(),
            port,
            &identity,
            clone.then_some(destination.as_path()),
        )
        .await;
        let result = frames.last().unwrap();
        if clone {
            assert_eq!(result["kind"], "complete", "{result}");
            let repo = git2::Repository::open(&destination).unwrap();
            assert_eq!(repo.head().unwrap().target(), Some(expected));
            assert_eq!(
                repo.find_remote("origin").unwrap().url(),
                Some(format!("ssh://git@127.0.0.1:{port}/synthetic-repo").as_str())
            );
            assert_eq!(
                repo.find_branch("main", git2::BranchType::Local)
                    .unwrap()
                    .upstream()
                    .unwrap()
                    .name()
                    .unwrap(),
                Some("origin/main")
            );
            assert_eq!(
                std::fs::read(destination.join("verified.txt")).unwrap(),
                b"real SSH and Git checkout\n"
            );
        } else {
            assert_eq!(result["kind"], "inspected", "{result}");
            assert_eq!(result["branches"], serde_json::json!(["main"]));
            assert_eq!(result["default_branch"], "main");
        }
        assert_eq!(offered.load(Ordering::SeqCst), 1);
        assert_eq!(authenticated.load(Ordering::SeqCst), 1);
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn helper_rejects_untrusted_hosts_before_offering_key_and_never_retries_wrong_identity() {
    let directory = tempfile::tempdir().unwrap();
    let identity = new_key();
    for condition in ["unknown", "changed", "revoked", "wrong_identity"] {
        let child_home = directory.path().join(condition);
        std::fs::create_dir(&child_home).unwrap();
        let host_key = new_key();
        let (port, offered, authenticated, server) = serve(
            host_key.clone(),
            identity.public_key().clone(),
            child_home.clone(),
        )
        .await;
        match condition {
            "unknown" => {}
            "changed" => trust(&child_home, port, new_key().public_key(), false),
            "revoked" => trust(&child_home, port, host_key.public_key(), true),
            _ => trust(&child_home, port, host_key.public_key(), false),
        }
        let supplied = if condition == "wrong_identity" {
            new_key()
        } else {
            identity.clone()
        };
        let frames = run_worker(&child_home, port, &supplied, None).await;
        let result = frames.last().unwrap();
        assert_eq!(result["kind"], "error", "{result}");
        let expected = if condition == "wrong_identity" {
            "SSH key authentication failed"
        } else {
            "SSH host key"
        };
        assert!(
            result["message"].as_str().unwrap().contains(expected),
            "{condition}: {result}"
        );
        assert_eq!(
            offered.load(Ordering::SeqCst),
            usize::from(condition == "wrong_identity")
        );
        assert_eq!(authenticated.load(Ordering::SeqCst), 0);
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}
