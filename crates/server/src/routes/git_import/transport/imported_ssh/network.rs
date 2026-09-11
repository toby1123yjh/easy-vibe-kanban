//! SSH network routing only. Host trust, identity and repository stay pinned
//! to the user's original remote, regardless of the TCP endpoint used here.

use std::{io, net::IpAddr};

use hyper_util::client::proxy::matcher::{Intercept, Matcher};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use zeroize::Zeroizing;

use super::{Failure, RemoteUrl};

const MAX_PROXY_HEADERS: usize = 16 * 1024;
const INVALID_PROXY: &str = "SSH proxy configuration is invalid";
const INVALID_RESPONSE: &str = "SSH proxy response is invalid or exceeds the header limit";

pub(super) struct Route {
    proxy: Option<Intercept>,
}

impl Route {
    pub(super) fn from_system(remote: &RemoteUrl) -> Result<Self, Failure> {
        Self::select(remote, &Matcher::from_system())
    }

    fn select(remote: &RemoteUrl, matcher: &Matcher) -> Result<Self, Failure> {
        let host = remote.host.trim_start_matches('[').trim_end_matches(']');
        // Local fixtures and users' loopback SSH servers must not leave the
        // machine, even if the system proxy does not define its own bypass.
        if host.eq_ignore_ascii_case("localhost")
            || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
        {
            return Ok(Self { proxy: None });
        }
        // Proxy conventions route secure destinations with HTTPS_PROXY (or
        // ALL_PROXY/system settings). This URI is for selection, not HTTP to
        // the Git server. The matcher applies NO_PROXY before intercepting.
        let destination = format!("https://{}/", authority(host, remote.port))
            .parse::<http::Uri>()
            .map_err(|_| Failure::Transport(INVALID_PROXY))?;
        let proxy = matcher.intercept(&destination);
        if let Some(proxy) = &proxy {
            if proxy.uri().scheme_str() != Some("http") {
                return Err(Failure::Transport(
                    "SSH proxy scheme is unsupported; configure an HTTP CONNECT proxy",
                ));
            }
            if proxy.uri().host().is_none() {
                return Err(Failure::Transport(INVALID_PROXY));
            }
        }
        Ok(Self { proxy })
    }

    // The caller applies one timeout to TCP + CONNECT + the SSH handshake.
    pub(super) async fn connect(&self, host: &str, port: u16) -> Result<TcpStream, Failure> {
        let Some(proxy) = &self.proxy else {
            return TcpStream::connect((host, port))
                .await
                .map_err(network_error);
        };
        let proxy_host = proxy
            .uri()
            .host()
            .ok_or(Failure::Transport(INVALID_PROXY))?
            .trim_start_matches('[')
            .trim_end_matches(']');
        let mut stream = TcpStream::connect((proxy_host, proxy.uri().port_u16().unwrap_or(80)))
            .await
            .map_err(network_error)?;
        let target = authority(host, port);
        let mut request =
            Zeroizing::new(format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n").into_bytes());
        if let Some(auth) = proxy.basic_auth() {
            request.extend_from_slice(b"Proxy-Authorization: ");
            request.extend_from_slice(auth.as_bytes());
            request.extend_from_slice(b"\r\n");
        }
        request.extend_from_slice(b"\r\n");
        stream.write_all(&request).await.map_err(network_error)?;
        drop(request);
        read_connect_response(&mut stream).await?;
        Ok(stream)
    }
}

fn authority(host: &str, port: u16) -> String {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn network_error(error: io::Error) -> Failure {
    Failure::from(russh::Error::IO(error))
}

async fn read_connect_response(stream: &mut TcpStream) -> Result<(), Failure> {
    let mut headers = Vec::new();
    // Consume exactly the HTTP header. A buffered read may also consume the
    // first SSH bytes in the same TCP packet, breaking the subsequent handshake.
    while headers.len() < MAX_PROXY_HEADERS {
        let byte = stream.read_u8().await.map_err(network_error)?;
        headers.push(byte);
        if headers.ends_with(b"\r\n\r\n") {
            let line = headers
                .split(|byte| *byte == b'\r')
                .next()
                .ok_or(Failure::Transport(INVALID_RESPONSE))?;
            let mut fields = line.split(|byte| *byte == b' ');
            let version = fields.next();
            let status = fields.next().unwrap_or_default();
            if !matches!(version, Some(b"HTTP/1.0" | b"HTTP/1.1"))
                || status.len() != 3
                || !status.iter().all(u8::is_ascii_digit)
            {
                return Err(Failure::Transport(INVALID_RESPONSE));
            }
            return match status {
                [b'2', _, _] => Ok(()),
                b"407" => Err(Failure::Transport("SSH proxy authentication failed")),
                _ => Err(Failure::Transport("SSH proxy rejected the CONNECT tunnel")),
            };
        }
    }
    Err(Failure::Transport(INVALID_RESPONSE))
}

pub(super) fn github_fallback(remote: &RemoteUrl, error: Failure) -> bool {
    // No endpoint guessing for GitLab/custom servers or explicitly chosen
    // nonstandard ports. In particular, never retry trust or identity failures.
    remote.host.eq_ignore_ascii_case("github.com")
        && remote.port == 22
        && error.retryable_connection()
}

#[cfg(test)]
mod tests {
    use tokio::net::TcpListener;

    use super::*;

    fn remote(host: &str, port: u16) -> RemoteUrl {
        super::super::super::parse_url(&format!(
            "ssh://git@{}/synthetic-repo",
            authority(host, port)
        ))
        .unwrap()
    }

    #[test]
    fn proxy_selection_obeys_bypass_and_rejects_unsupported_schemes() {
        let matcher = Matcher::builder()
            .all("http://127.0.0.1:10808")
            .no("git.example.invalid")
            .build();
        for host in ["localhost", "127.0.0.1", "::1", "git.example.invalid"] {
            assert!(
                Route::select(&remote(host, 22), &matcher)
                    .unwrap()
                    .proxy
                    .is_none()
            );
        }
        assert!(
            Route::select(&remote("github.com", 22), &matcher)
                .unwrap()
                .proxy
                .is_some()
        );
        for proxy in ["socks5://127.0.0.1:10808", "https://127.0.0.1:10808"] {
            let matcher = Matcher::builder().all(proxy).build();
            let error = Route::select(&remote("github.com", 22), &matcher)
                .err()
                .unwrap();
            assert!(error.to_string().contains("proxy scheme is unsupported"));
            assert!(!error.retryable_connection());
        }
    }

    #[test]
    fn github_fallback_is_limited_to_network_failure_on_original_default_endpoint() {
        let github = remote("github.com", 22);
        for error in [
            Failure::Timeout,
            Failure::from(russh::Error::HUP),
            Failure::from(russh::Error::IO(io::Error::from(
                io::ErrorKind::ConnectionReset,
            ))),
        ] {
            assert!(github_fallback(&github, error));
            for endpoint in [
                remote("gitlab.com", 22),
                remote("github.example.invalid", 22),
                remote("github.com", 2222),
                remote("ssh.github.com", 443),
            ] {
                assert!(!github_fallback(&endpoint, error));
            }
        }
        for error in [
            Failure::HostKey,
            Failure::Authentication,
            Failure::Repository,
            Failure::Connection,
            Failure::from(russh::Error::WrongServerSig),
            Failure::from(russh::Error::Kex),
            Failure::from(russh::Error::Version),
            Failure::Transport("SSH proxy authentication failed"),
            Failure::Transport("SSH proxy rejected the CONNECT tunnel"),
        ] {
            assert!(!github_fallback(&github, error));
        }
    }

    #[tokio::test]
    async fn connect_keeps_first_ssh_bytes_and_sends_basic_auth_only_to_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!(
            "http://synthetic:proxy-password@127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        );
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(socket.read_u8().await.unwrap());
                assert!(request.len() < MAX_PROXY_HEADERS);
            }
            let request = String::from_utf8(request).unwrap();
            assert!(
                request.starts_with("CONNECT github.com:22 HTTP/1.1\r\nHost: github.com:22\r\n")
            );
            assert!(
                request.contains("Proxy-Authorization: Basic c3ludGhldGljOnByb3h5LXBhc3N3b3Jk\r\n")
            );
            socket
                .write_all(b"HTTP/1.1 200 Connected\r\n\r\nSSH-2.0-synthetic\r\n")
                .await
                .unwrap();
        });
        let route = Route::select(
            &remote("github.com", 22),
            &Matcher::builder().all(proxy).build(),
        )
        .unwrap();
        let mut stream = route.connect("github.com", 22).await.unwrap();
        let mut banner = Vec::new();
        stream.read_to_end(&mut banner).await.unwrap();
        assert_eq!(banner, b"SSH-2.0-synthetic\r\n");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn proxy_response_is_bounded_and_never_exposes_response_payload() {
        for (response, expected) in [
            (
                b"HTTP/1.1 407 PRIVATE KEY secret\r\n\r\n".to_vec(),
                "SSH proxy authentication failed",
            ),
            (
                b"HTTP/1.1 403 PRIVATE KEY secret\r\n\r\n".to_vec(),
                "SSH proxy rejected the CONNECT tunnel",
            ),
            (
                b"HTTP/1.1 200evil PRIVATE KEY secret\r\n\r\n".to_vec(),
                INVALID_RESPONSE,
            ),
            (vec![b'x'; MAX_PROXY_HEADERS + 1], INVALID_RESPONSE),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let _ = socket.write_all(&response).await;
            });
            let mut socket = TcpStream::connect(address).await.unwrap();
            let error = read_connect_response(&mut socket).await.unwrap_err();
            assert_eq!(error.to_string(), expected);
            assert!(!error.retryable_connection());
            assert_eq!(super::super::safe_failure_reason(expected), Some(expected));
            server.await.unwrap();
        }
    }
}
