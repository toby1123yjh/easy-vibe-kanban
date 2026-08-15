//! Provider transport boundary for local agent runtimes.
//!
//! A transport owns bytes and connection state only. It does not classify
//! retryability, choose a terminal AgentRun state, or terminate a process.

use std::fmt;

use async_trait::async_trait;
pub(crate) use executors::runtime::AgentTransportKind as TransportKind;

pub(crate) const SUPPORTED_TRANSPORTS: [TransportKind; 6] = [
    TransportKind::StdioCli,
    TransportKind::StdioRpc,
    TransportKind::Acp,
    TransportKind::AppServerJsonrpc,
    TransportKind::HttpSidecar,
    TransportKind::InProcess,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TransportDescriptor {
    pub kind: TransportKind,
}

impl TransportDescriptor {
    pub(crate) const fn new(kind: TransportKind) -> Self {
        Self { kind }
    }

    pub(crate) const fn is_process_bound(self) -> bool {
        !matches!(self.kind, TransportKind::InProcess)
    }
}
use tokio::sync::mpsc;
use uuid::Uuid;

const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

pub(crate) async fn write_json_frame<W, T>(writer: &mut W, value: &T) -> Result<(), TransportError>
where
    W: tokio::io::AsyncWrite + Unpin,
    T: serde::Serialize,
{
    use tokio::io::AsyncWriteExt;

    let payload =
        serde_json::to_vec(value).map_err(|error| TransportError::Protocol(error.to_string()))?;
    let length = u32::try_from(payload.len()).map_err(|_| {
        TransportError::Protocol(format!("frame exceeds {MAX_FRAME_BYTES} byte limit"))
    })?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(TransportError::Protocol(format!(
            "frame exceeds {MAX_FRAME_BYTES} byte limit"
        )));
    }
    writer
        .write_u32(length)
        .await
        .map_err(|error| TransportError::Io(error.to_string()))?;
    writer
        .write_all(&payload)
        .await
        .map_err(|error| TransportError::Io(error.to_string()))?;
    writer
        .flush()
        .await
        .map_err(|error| TransportError::Io(error.to_string()))
}

pub(crate) async fn read_json_frame<R, T>(reader: &mut R) -> Result<T, TransportError>
where
    R: tokio::io::AsyncRead + Unpin,
    T: serde::de::DeserializeOwned,
{
    use tokio::io::AsyncReadExt;

    let length = reader
        .read_u32()
        .await
        .map_err(|error| TransportError::Io(error.to_string()))?;
    let length =
        usize::try_from(length).map_err(|error| TransportError::Protocol(error.to_string()))?;
    if length > MAX_FRAME_BYTES {
        return Err(TransportError::Protocol(format!(
            "frame exceeds {MAX_FRAME_BYTES} byte limit"
        )));
    }
    let mut payload = vec![0; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| TransportError::Io(error.to_string()))?;
    serde_json::from_slice(&payload).map_err(|error| TransportError::Protocol(error.to_string()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TransportFrame {
    pub correlation_id: Uuid,
    pub sequence: u64,
    pub content_type: String,
    pub payload: Vec<u8>,
}

impl TransportFrame {
    pub(crate) fn new(correlation_id: Uuid, sequence: u64, payload: Vec<u8>) -> Self {
        Self {
            correlation_id,
            sequence,
            content_type: "application/octet-stream".to_string(),
            payload,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum TransportError {
    #[error("transport is temporarily unavailable: {0}")]
    TemporarilyUnavailable(String),
    #[error("transport is closed")]
    Closed,
    #[error("transport I/O failed: {0}")]
    Io(String),
    #[error("transport protocol error: {0}")]
    Protocol(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransportAvailability {
    Available,
    TemporarilyUnavailable,
    Closed,
}

/// The protocol channel exposed by a provider adapter.
#[async_trait]
pub(crate) trait AgentTransport: Send + Sync {
    fn kind(&self) -> TransportKind;

    fn availability(&self) -> TransportAvailability {
        TransportAvailability::Available
    }

    async fn send(&self, frame: TransportFrame) -> Result<(), TransportError>;

    async fn recv(&self) -> Result<TransportFrame, TransportError>;

    async fn close(&self) -> Result<(), TransportError>;
}

/// An in-process transport is useful for adapters implemented in Rust and for
/// deterministic tests. The two endpoints share no process lifecycle policy:
/// dropping an endpoint only makes the peer observe `Closed`.
pub(crate) struct InProcessTransport {
    inbound: tokio::sync::Mutex<mpsc::Receiver<TransportFrame>>,
    outbound: mpsc::Sender<TransportFrame>,
    closed: std::sync::atomic::AtomicBool,
}

impl fmt::Debug for InProcessTransport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InProcessTransport")
            .field(
                "closed",
                &self.closed.load(std::sync::atomic::Ordering::Acquire),
            )
            .finish_non_exhaustive()
    }
}

impl InProcessTransport {
    pub(crate) fn pair(capacity: usize) -> (Self, Self) {
        let (left_tx, left_rx) = mpsc::channel(capacity);
        let (right_tx, right_rx) = mpsc::channel(capacity);
        (
            Self {
                inbound: tokio::sync::Mutex::new(right_rx),
                outbound: left_tx,
                closed: std::sync::atomic::AtomicBool::new(false),
            },
            Self {
                inbound: tokio::sync::Mutex::new(left_rx),
                outbound: right_tx,
                closed: std::sync::atomic::AtomicBool::new(false),
            },
        )
    }
}

#[async_trait]
impl AgentTransport for InProcessTransport {
    fn kind(&self) -> TransportKind {
        TransportKind::InProcess
    }

    fn availability(&self) -> TransportAvailability {
        if self.closed.load(std::sync::atomic::Ordering::Acquire) {
            TransportAvailability::Closed
        } else {
            TransportAvailability::Available
        }
    }

    async fn send(&self, frame: TransportFrame) -> Result<(), TransportError> {
        if self.availability() == TransportAvailability::Closed {
            return Err(TransportError::Closed);
        }
        self.outbound
            .send(frame)
            .await
            .map_err(|_| TransportError::Closed)
    }

    async fn recv(&self) -> Result<TransportFrame, TransportError> {
        if self.availability() == TransportAvailability::Closed {
            return Err(TransportError::Closed);
        }
        self.inbound
            .lock()
            .await
            .recv()
            .await
            .ok_or(TransportError::Closed)
    }

    async fn close(&self) -> Result<(), TransportError> {
        self.closed
            .store(true, std::sync::atomic::Ordering::Release);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_process_pair_preserves_frame_order_and_identity() {
        let (left, right) = InProcessTransport::pair(4);
        let correlation_id = Uuid::new_v4();
        let sent = TransportFrame::new(correlation_id, 1, b"hello".to_vec());
        left.send(sent.clone()).await.expect("send frame");
        assert_eq!(right.recv().await.expect("receive frame"), sent);
        assert_eq!(left.kind(), TransportKind::InProcess);
    }

    #[tokio::test]
    async fn temporarily_unavailable_does_not_imply_terminal_or_retry_decision() {
        let error = TransportError::TemporarilyUnavailable("sidecar warming".to_string());
        assert_eq!(
            error.to_string(),
            "transport is temporarily unavailable: sidecar warming"
        );
    }

    #[test]
    fn transport_catalog_keeps_process_policy_outside_transport() {
        assert_eq!(SUPPORTED_TRANSPORTS.len(), 6);
        assert!(TransportDescriptor::new(TransportKind::StdioCli).is_process_bound());
        assert!(!TransportDescriptor::new(TransportKind::InProcess).is_process_bound());
    }
}
