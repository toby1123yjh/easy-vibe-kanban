//! Attempt-owned replay log. Payloads stay on disk; only seek offsets are kept
//! in memory. A slow subscriber holds at most one bounded page.
use std::{io::SeekFrom, path::Path};

use tokio::{
    fs::File,
    io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader},
};

use super::{HostEvent, ProcessHostError};

pub(super) struct HostJournal {
    file: File,
    offsets: Vec<u64>,
    end: u64,
}

/// Recovery is sequential and page-bounded. Only use after the owning host is
/// confirmed absent; a final incomplete line is an uncommitted append.
pub(crate) struct HostJournalReplay {
    reader: BufReader<File>,
    sequence: u64,
    after_sequence: u64,
}

impl HostJournalReplay {
    pub async fn open(path: &Path, after_sequence: u64) -> Result<Self, ProcessHostError> {
        Ok(Self {
            reader: BufReader::new(File::open(path).await?),
            sequence: 0,
            after_sequence,
        })
    }

    pub async fn next_page(&mut self) -> Result<Vec<HostEvent>, ProcessHostError> {
        let mut events = Vec::new();
        let mut page_bytes = 0;
        while events.len() < super::HOST_STREAM_PAGE_SIZE && page_bytes < 4 * 1024 * 1024 {
            let mut bytes = Vec::new();
            let count = self.reader.read_until(b'\n', &mut bytes).await?;
            if count == 0 || bytes.last() != Some(&b'\n') {
                break;
            }
            let event: HostEvent = serde_json::from_slice(&bytes)
                .map_err(|error| ProcessHostError::Protocol(error.to_string()))?;
            self.sequence += 1;
            if event.sequence != self.sequence {
                return Err(ProcessHostError::Protocol(
                    "host journal sequence gap".into(),
                ));
            }
            if event.sequence > self.after_sequence {
                events.push(event);
                page_bytes += count;
            }
        }
        Ok(events)
    }
}

impl HostJournal {
    pub async fn create(path: &Path) -> Result<Self, ProcessHostError> {
        let file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(path)
            .await?;
        Ok(Self {
            file,
            offsets: Vec::new(),
            end: 0,
        })
    }

    pub fn last_sequence(&self) -> u64 {
        self.offsets.len() as u64
    }

    pub async fn append(&mut self, event: &HostEvent) -> Result<(), ProcessHostError> {
        let bytes = serde_json::to_vec(event)
            .map_err(|error| ProcessHostError::Protocol(error.to_string()))?;
        self.file.seek(SeekFrom::Start(self.end)).await?;
        self.file.write_all(&bytes).await?;
        self.file.write_all(b"\n").await?;
        self.file.flush().await?;
        self.file.sync_data().await?;
        self.offsets.push(self.end);
        self.end += bytes.len() as u64 + 1;
        Ok(())
    }

    pub async fn read_after(
        &mut self,
        sequence: u64,
        limit: usize,
    ) -> Result<Vec<HostEvent>, ProcessHostError> {
        let start = usize::try_from(sequence)
            .unwrap_or(usize::MAX)
            .min(self.offsets.len());
        let end = start.saturating_add(limit).min(self.offsets.len());
        let mut events = Vec::with_capacity(end - start);
        let mut page_bytes = 0;
        for index in start..end {
            let offset = self.offsets[index];
            let next = self.offsets.get(index + 1).copied().unwrap_or(self.end);
            // Keep pages below the transport frame budget. One oversized event
            // is still subject to the transport's existing hard frame limit.
            if limit != usize::MAX
                && !events.is_empty()
                && page_bytes + next - offset > 4 * 1024 * 1024
            {
                break;
            }
            self.file.seek(SeekFrom::Start(offset)).await?;
            let mut bytes = vec![0; (next - offset) as usize];
            self.file.read_exact(&mut bytes).await?;
            events.push(
                serde_json::from_slice(&bytes)
                    .map_err(|error| ProcessHostError::Protocol(error.to_string()))?,
            );
            page_bytes += next - offset;
        }
        Ok(events)
    }
}
