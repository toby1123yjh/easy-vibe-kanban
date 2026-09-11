//! Memory-only SSH for the isolated Git import worker. libgit2 still owns Git's
//! wire protocol, pack verification and checkout; russh owns SSH on every OS.

use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use git2::transport::{Service, SmartSubtransport, SmartSubtransportStream, Transport};
use hmac::{Hmac, Mac};
use russh::{ChannelMsg, client};
use sha1::Sha1;
use ssh_key::known_hosts::{HostPatterns, KnownHosts, Marker};
use tokio::{runtime::Handle, sync::mpsc};
use tokio_util::io::SyncIoBridge;

use super::{Control, RemoteUrl, WorkerStage};

mod network;

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
static REGISTERED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, thiserror::Error)]
enum Failure {
    #[error("SSH host key is unknown, changed, revoked, or known_hosts is unreadable")]
    HostKey,
    #[error("SSH connection or handshake failed")]
    Connection,
    #[error("{0}")]
    Transport(&'static str),
    #[error("SSH operation timed out")]
    Timeout,
    #[error("SSH key authentication failed")]
    Authentication,
    #[error("SSH repository command was rejected")]
    Repository,
}

impl From<russh::Error> for Failure {
    fn from(error: russh::Error) -> Self {
        // Classify only typed discriminants. Never retain error messages,
        // algorithm lists, banners or other server-controlled payloads.
        use russh::Error as E;
        match error {
            E::UnknownKey | E::KeyChanged { .. } => Self::HostKey,
            E::ConnectionTimeout | E::KeepaliveTimeout | E::InactivityTimeout | E::Elapsed(_) => {
                Self::Timeout
            }
            E::NoCommonAlgo { kind, .. } => Self::Transport(match kind {
                russh::AlgorithmKind::Kex => "SSH key exchange has no common algorithm",
                russh::AlgorithmKind::Key => "SSH host key has no common algorithm",
                russh::AlgorithmKind::Cipher => "SSH cipher has no common algorithm",
                russh::AlgorithmKind::Compression => "SSH compression has no common algorithm",
                russh::AlgorithmKind::Mac => "SSH MAC has no common algorithm",
            }),
            E::IO(error) => Self::Transport(match error.kind() {
                io::ErrorKind::ConnectionRefused => "SSH network I/O failed (ConnectionRefused)",
                io::ErrorKind::ConnectionReset => "SSH network I/O failed (ConnectionReset)",
                io::ErrorKind::ConnectionAborted => "SSH network I/O failed (ConnectionAborted)",
                io::ErrorKind::UnexpectedEof => {
                    "SSH connection ended before protocol exchange completed (UnexpectedEof)"
                }
                io::ErrorKind::TimedOut => "SSH network I/O failed (TimedOut)",
                io::ErrorKind::PermissionDenied => "SSH network I/O failed (PermissionDenied)",
                io::ErrorKind::AddrNotAvailable => "SSH network I/O failed (AddrNotAvailable)",
                _ => "SSH network I/O failed (other I/O kind)",
            }),
            E::HUP => Self::Transport("SSH connection closed by remote host (HUP)"),
            E::Disconnect => Self::Transport("SSH peer disconnected during protocol exchange"),
            E::Version => Self::Transport("SSH peer returned an invalid protocol version"),
            E::Kex | E::KexInit => Self::Transport("SSH key exchange failed"),
            E::WrongServerSig => Self::Transport("SSH server signature verification failed"),
            _ => Self::Connection,
        }
    }
}

/// Only these fixed typed-transport reasons may survive libgit2's error bridge.
/// Returning a static entry prevents accidentally forwarding raw library text.
pub(super) fn safe_failure_reason(message: &str) -> Option<&'static str> {
    const REASONS: &[&str] = &[
        "SSH key exchange has no common algorithm",
        "SSH host key has no common algorithm",
        "SSH cipher has no common algorithm",
        "SSH compression has no common algorithm",
        "SSH MAC has no common algorithm",
        "SSH network I/O failed (ConnectionRefused)",
        "SSH network I/O failed (ConnectionReset)",
        "SSH network I/O failed (ConnectionAborted)",
        "SSH connection ended before protocol exchange completed (UnexpectedEof)",
        "SSH network I/O failed (TimedOut)",
        "SSH network I/O failed (PermissionDenied)",
        "SSH network I/O failed (AddrNotAvailable)",
        "SSH network I/O failed (other I/O kind)",
        "SSH connection closed by remote host (HUP)",
        "SSH peer disconnected during protocol exchange",
        "SSH peer returned an invalid protocol version",
        "SSH key exchange failed",
        "SSH server signature verification failed",
        "SSH proxy scheme is unsupported; configure an HTTP CONNECT proxy",
        "SSH proxy configuration is invalid",
        "SSH proxy response is invalid or exceeds the header limit",
        "SSH proxy authentication failed",
        "SSH proxy rejected the CONNECT tunnel",
    ];
    REASONS.iter().copied().find(|reason| *reason == message)
}

impl Failure {
    fn retryable_connection(self) -> bool {
        // This decision is used only while establishing SSH, never after
        // authentication starts. Trust/crypto/proxy policy failures are final.
        matches!(
            self,
            Self::Timeout
                | Self::Transport(
                    "SSH network I/O failed (ConnectionRefused)"
                        | "SSH network I/O failed (ConnectionReset)"
                        | "SSH network I/O failed (ConnectionAborted)"
                        | "SSH connection ended before protocol exchange completed (UnexpectedEof)"
                        | "SSH network I/O failed (TimedOut)"
                        | "SSH network I/O failed (other I/O kind)"
                        | "SSH connection closed by remote host (HUP)"
                        | "SSH peer disconnected during protocol exchange"
                )
        )
    }

    fn git(self) -> git2::Error {
        let code = match self {
            Self::HostKey => git2::ErrorCode::Certificate,
            Self::Authentication => git2::ErrorCode::Auth,
            Self::Repository => git2::ErrorCode::NotFound,
            _ => git2::ErrorCode::GenericError,
        };
        git2::Error::new(code, git2::ErrorClass::Ssh, self.to_string())
    }
}

struct HostVerifier {
    host: String,
    port: u16,
    known_hosts: PathBuf,
}

#[async_trait]
impl client::Handler for HostVerifier {
    type Error = Failure;

    async fn check_server_key(&mut self, key: &ssh_key::PublicKey) -> Result<bool, Failure> {
        verify_host_key(&self.known_hosts, &self.host, self.port, key)?;
        Ok(true)
    }
}

fn verify_host_key(
    path: &Path,
    host: &str,
    port: u16,
    key: &ssh_key::PublicKey,
) -> Result<(), Failure> {
    let contents = std::fs::read_to_string(path).map_err(|_| Failure::HostKey)?;
    let authority = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    let mut matched = false;
    for line in contents.lines() {
        // The OpenSSH file format permits tabs and repeated whitespace, while
        // ssh-key's parser expects single spaces between fields.
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let field_count = if line.starts_with('@') { 4 } else { 3 };
        let normalized = line
            .split_whitespace()
            .take(field_count)
            .collect::<Vec<_>>()
            .join(" ");
        let entry = KnownHosts::new(&normalized)
            .next()
            .ok_or(Failure::HostKey)?
            .map_err(|_| Failure::HostKey)?;
        if !matches_host(entry.host_patterns(), &authority) {
            continue;
        }
        // Compare the actual key, not a display comment. A revoked key can
        // never be made trusted by a second ordinary entry in the same file.
        let same_key = entry.public_key().key_data() == key.key_data();
        match entry.marker() {
            Some(Marker::Revoked) if same_key => return Err(Failure::HostKey),
            Some(_) => {} // CA entries do not trust an uncertified host key.
            None if same_key => matched = true,
            None => {}
        }
    }
    if matched {
        Ok(())
    } else {
        Err(Failure::HostKey)
    }
}

fn matches_host(patterns: &HostPatterns, host: &str) -> bool {
    match patterns {
        HostPatterns::HashedName { salt, hash } => Hmac::<Sha1>::new_from_slice(salt)
            .map(|mac| mac.chain_update(host.as_bytes()).verify_slice(hash).is_ok())
            .unwrap_or(false),
        HostPatterns::Patterns(patterns) => {
            let mut matched = false;
            for pattern in patterns {
                if let Some(negative) = pattern.strip_prefix('!') {
                    if wildcard_matches(negative.as_bytes(), host.as_bytes()) {
                        return false;
                    }
                } else if wildcard_matches(pattern.as_bytes(), host.as_bytes()) {
                    matched = true;
                }
            }
            matched
        }
    }
}

fn wildcard_matches(pattern: &[u8], value: &[u8]) -> bool {
    let (mut p, mut v, mut star, mut retry) = (0, 0, None, 0);
    while v < value.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p].eq_ignore_ascii_case(&value[v])) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            p += 1;
            retry = v;
        } else if let Some(previous) = star {
            p = previous + 1;
            retry += 1;
            v = retry;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

fn upload_pack_command(remote: &RemoteUrl) -> Result<String, git2::Error> {
    let path = if remote.url.contains("://") {
        let parsed = url::Url::parse(&remote.url).map_err(|_| Failure::Repository.git())?;
        percent_encoding::percent_decode_str(parsed.path())
            .decode_utf8()
            .map_err(|_| Failure::Repository.git())?
            .into_owned()
    } else {
        // SCP-like paths are relative to the SSH account's home. Do not prefix
        // a slash or percent-decode them: that would select a different repo.
        remote
            .url
            .split_once(':')
            .ok_or_else(|| Failure::Repository.git())?
            .1
            .to_string()
    };
    if path.is_empty() || path.starts_with('-') || path.chars().any(char::is_control) {
        return Err(Failure::Repository.git());
    }
    // SSH exec is a remote shell string, not an argv array. The executable and
    // command shape matches native Git (hosting providers parse this exact
    // shape). Reject option-like paths and single-quote the repo argument.
    Ok(format!("git-upload-pack '{}'", path.replace('\'', "'\\''")))
}

#[derive(Clone)]
struct ImportedTransport {
    remote: RemoteUrl,
    key: Arc<ssh_key::PrivateKey>,
    known_hosts: PathBuf,
    command: String,
    runtime: Handle,
    control: Arc<Control>,
    stages: mpsc::Sender<WorkerStage>,
}

/// Must only run in the dedicated, one-operation helper before creating any
/// Git remote. The web server and unit tests must never mutate this registry.
pub(super) fn register_for_worker(
    remote: RemoteUrl,
    key: ssh_key::PrivateKey,
    control: Arc<Control>,
    stages: mpsc::Sender<WorkerStage>,
) -> Result<(), git2::Error> {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new("--git-import-worker"))
        || REGISTERED.swap(true, Ordering::AcqRel)
    {
        return Err(git2::Error::from_str(
            "Git import transport is restricted to its isolated worker",
        ));
    }
    let transport = ImportedTransport {
        command: upload_pack_command(&remote)?,
        remote,
        key: Arc::new(key),
        // Both Windows OpenSSH and Unix use .ssh. russh 0.48's default Windows
        // helper uses `ssh`, so deliberately resolve the standard path here.
        known_hosts: home::home_dir()
            .ok_or_else(|| Failure::HostKey.git())?
            .join(".ssh/known_hosts"),
        runtime: Handle::current(),
        control,
        stages,
    };
    // SAFETY: this is the early dedicated helper, with exactly one blocking
    // Git operation and no web/deployment startup or other Git transport users.
    // Registration precedes all Git remotes; the process exits after this one
    // operation, releasing the registry's credential capture with the process.
    unsafe {
        // libgit2 also routes SCP-like URLs to registered SSH transports.
        // Keeping the original URL preserves origin and all fetch refspecs.
        git2::transport::register("ssh", move |remote| {
            Transport::smart(remote, false, transport.clone())
        })
    }
}

impl SmartSubtransport for ImportedTransport {
    fn action(
        &self,
        url: &str,
        action: Service,
    ) -> Result<Box<dyn SmartSubtransportStream>, git2::Error> {
        if url != self.remote.url || action != Service::UploadPackLs || self.control.cancelled() {
            return Err(git2::Error::from_str(
                "SSH import target or operation is not allowed",
            ));
        }
        // No URL supplied by libgit2 can change the already-pinned host, port,
        // username, repository or identity. Push operations are never accepted.
        let (session, channel) = self
            .runtime
            .block_on(self.connect())
            .map_err(Failure::git)?;
        Ok(Box::new(ImportedStream {
            stream: SyncIoBridge::new_with_handle(channel.into_stream(), self.runtime.clone()),
            _session: session,
            control: self.control.clone(),
        }))
    }

    fn close(&self) -> Result<(), git2::Error> {
        Ok(())
    }
}

impl ImportedTransport {
    async fn handshake(
        &self,
        network: &network::Route,
        host: &str,
        port: u16,
    ) -> Result<client::Handle<HostVerifier>, Failure> {
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(120)),
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 3,
            ..Default::default()
        });
        let verifier = HostVerifier {
            // The official GitHub 443 endpoint shares GitHub's host keys.
            // Always verify the original host, never introduce a trust bypass
            // or require another trust entry just because TCP uses a proxy.
            host: self.remote.host.clone(),
            port: self.remote.port,
            known_hosts: self.known_hosts.clone(),
        };
        tokio::time::timeout(CONNECTION_TIMEOUT, async {
            let stream = network.connect(host, port).await?;
            client::connect_stream(config, stream, verifier).await
        })
        .await
        .map_err(|_| Failure::Timeout)?
    }

    async fn connect(
        &self,
    ) -> Result<(client::Handle<HostVerifier>, russh::Channel<client::Msg>), Failure> {
        self.stages
            .send(WorkerStage::ConnectingSsh)
            .await
            .map_err(|_| Failure::Connection)?;
        // Select the system/environment route once for the original host.
        // NO_PROXY also remains authoritative for the alternate endpoint.
        let network = network::Route::from_system(&self.remote)?;
        let mut session = match self
            .handshake(&network, &self.remote.host, self.remote.port)
            .await
        {
            Ok(session) => session,
            Err(error) if network::github_fallback(&self.remote, error) => {
                if self.control.cancelled() {
                    return Err(Failure::Connection);
                }
                self.handshake(&network, "ssh.github.com", 443).await?
            }
            Err(error) => return Err(error),
        };
        self.stages
            .send(WorkerStage::Authenticating)
            .await
            .map_err(|_| Failure::Connection)?;
        // Exactly one identity and one authentication attempt. No agent/system
        // identity fallback, password login, or repeated rejected-key callback.
        let authenticated = tokio::time::timeout(
            CONNECTION_TIMEOUT,
            session.authenticate_publickey(self.remote.username.clone(), self.key.clone()),
        )
        .await
        .map_err(|_| Failure::Timeout)?
        .map_err(|_| Failure::Authentication)?;
        if !authenticated {
            return Err(Failure::Authentication);
        }
        let mut channel = tokio::time::timeout(CONNECTION_TIMEOUT, session.channel_open_session())
            .await
            .map_err(|_| Failure::Timeout)?
            .map_err(|_| Failure::Repository)?;
        channel
            .exec(true, self.command.as_bytes())
            .await
            .map_err(|_| Failure::Repository)?;
        tokio::time::timeout(CONNECTION_TIMEOUT, async {
            loop {
                match channel.wait().await {
                    Some(ChannelMsg::Success) => return Ok(()),
                    Some(ChannelMsg::WindowAdjusted { .. }) => continue,
                    _ => return Err(Failure::Repository),
                }
            }
        })
        .await
        .map_err(|_| Failure::Timeout)??;
        self.stages
            .send(WorkerStage::ReadingRefs)
            .await
            .map_err(|_| Failure::Connection)?;
        Ok((session, channel))
    }
}

struct ImportedStream {
    stream: SyncIoBridge<russh::ChannelStream<client::Msg>>,
    // Keep the client and its background session alive for the Git stream.
    _session: client::Handle<HostVerifier>,
    control: Arc<Control>,
}

impl Read for ImportedStream {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if self.control.cancelled() {
            return Err(io::Error::other("SSH import cancelled"));
        }
        self.stream
            .read(bytes)
            .map_err(|_| io::Error::other("SSH connection read failed"))
    }
}

impl Write for ImportedStream {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.control.cancelled() {
            return Err(io::Error::other("SSH import cancelled"));
        }
        self.stream
            .write(bytes)
            .map_err(|_| io::Error::other("SSH connection write failed"))
    }
    fn flush(&mut self) -> io::Result<()> {
        self.stream
            .flush()
            .map_err(|_| io::Error::other("SSH connection flush failed"))
    }
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    use super::*;

    #[test]
    fn typed_ssh_failures_preserve_cause_without_third_party_payloads() {
        for (error, expected) in [
            (
                russh::Error::HUP,
                "SSH connection closed by remote host (HUP)",
            ),
            (
                russh::Error::IO(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "PRIVATE KEY secret",
                )),
                "SSH connection ended before protocol exchange completed (UnexpectedEof)",
            ),
            (
                russh::Error::NoCommonAlgo {
                    kind: russh::AlgorithmKind::Kex,
                    ours: vec![],
                    theirs: vec!["PRIVATE KEY secret".into()],
                },
                "SSH key exchange has no common algorithm",
            ),
        ] {
            let git = Failure::from(error).git();
            assert_eq!(safe_failure_reason(git.message()), Some(expected));
            let response = super::super::imported_error(git).to_string();
            assert!(response.contains(expected));
            assert!(!response.contains("PRIVATE KEY"));
            assert!(!response.contains("secret"));
        }
    }

    #[test]
    fn host_trust_supports_hashed_ports_and_rejects_unknown_changed_and_revoked_keys() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("known_hosts");
        let key = ssh_key::PrivateKey::random(&mut rand::rngs::OsRng, ssh_key::Algorithm::Ed25519)
            .unwrap();
        let public = key.public_key().to_openssh().unwrap();
        let authority = "[127.0.0.1]:2222";
        let salt = b"synthetic-host-salt";
        let hash = Hmac::<Sha1>::new_from_slice(salt)
            .unwrap()
            .chain_update(authority)
            .finalize()
            .into_bytes();
        let encoder = base64::engine::general_purpose::STANDARD;
        let hashed = format!("|1|{}|{}", encoder.encode(salt), encoder.encode(hash));
        std::fs::write(&path, format!("{hashed}\t{public}\n")).unwrap();
        assert!(verify_host_key(&path, "127.0.0.1", 2222, key.public_key()).is_ok());
        assert!(verify_host_key(&path, "127.0.0.1", 22, key.public_key()).is_err());
        assert!(verify_host_key(&path, "different", 2222, key.public_key()).is_err());
        let changed =
            ssh_key::PrivateKey::random(&mut rand::rngs::OsRng, ssh_key::Algorithm::Ed25519)
                .unwrap();
        assert!(verify_host_key(&path, "127.0.0.1", 2222, changed.public_key()).is_err());
        std::fs::write(
            &path,
            format!("{hashed} {public}\n@revoked {hashed} {public}\n"),
        )
        .unwrap();
        assert!(verify_host_key(&path, "127.0.0.1", 2222, key.public_key()).is_err());
    }

    #[test]
    fn host_patterns_honor_negation() {
        let patterns =
            HostPatterns::Patterns(vec!["*.example.com".into(), "!private.example.com".into()]);
        assert!(matches_host(&patterns, "git.example.com"));
        assert!(!matches_host(&patterns, "private.example.com"));
        assert!(!matches_host(&patterns, "example.org"));
    }

    #[test]
    fn repository_command_quotes_paths_without_changing_scp_semantics() {
        let scp = super::super::parse_url("git@example.com:team/repo.git").unwrap();
        assert_eq!(
            upload_pack_command(&scp).unwrap(),
            "git-upload-pack 'team/repo.git'"
        );
        let ssh = super::super::parse_url("ssh://git@example.com/team/it%27s.git").unwrap();
        assert_eq!(
            upload_pack_command(&ssh).unwrap(),
            "git-upload-pack '/team/it'\\''s.git'"
        );
        let invalid = super::super::parse_url("ssh://git@example.com/team/%00.git").unwrap();
        assert!(upload_pack_command(&invalid).is_err());
    }
}
