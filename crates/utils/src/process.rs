use std::{future::Future, time::Duration};

use command_group::AsyncGroupChild;

const PROCESS_KILL_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_EXIT_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

async fn io_with_timeout<T>(
    future: impl Future<Output = std::io::Result<T>>,
    timeout: Duration,
    operation: &'static str,
) -> std::io::Result<T> {
    tokio::time::timeout(timeout, future).await.map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            format!("timed out while {operation}"),
        )
    })?
}

pub async fn kill_process_group(child: &mut AsyncGroupChild) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        // Use command_group's UnixChildExt::signal() which calls killpg()
        // with the pgid captured at spawn time. This works even after the
        // group leader has exited, unlike getpgid() which would fail.
        use command_group::{Signal, UnixChildExt};

        for sig in [Signal::SIGINT, Signal::SIGTERM, Signal::SIGKILL] {
            tracing::info!("Sending {:?} to process group", sig);
            if let Err(e) = child.signal(sig) {
                // break if the group does not exist anymore
                if e.raw_os_error() == Some(nix::libc::ESRCH) {
                    break;
                }
                tracing::warn!("Failed to send signal {:?} to process group: {}", sig, e);
            }
            if sig != Signal::SIGKILL {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }

    let kill_result = io_with_timeout(
        child.kill(),
        PROCESS_KILL_TIMEOUT,
        "terminating process group",
    )
    .await;
    match io_with_timeout(
        child.wait(),
        PROCESS_EXIT_WAIT_TIMEOUT,
        "waiting for process group exit",
    )
    .await
    {
        // A completed wait is the authoritative proof that the process is gone.
        Ok(_) => Ok(()),
        Err(wait_error) => match kill_result {
            Ok(()) => Err(wait_error),
            Err(kill_error) => Err(std::io::Error::new(
                wait_error.kind(),
                format!("{kill_error}; {wait_error}"),
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bounded_io_returns_timed_out_instead_of_waiting_forever() {
        let error = io_with_timeout(
            std::future::pending::<std::io::Result<()>>(),
            Duration::from_millis(10),
            "testing bounded wait",
        )
        .await
        .expect_err("pending I/O must time out");

        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(error.to_string().contains("testing bounded wait"));
    }
}
