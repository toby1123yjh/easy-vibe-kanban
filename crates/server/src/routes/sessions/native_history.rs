use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, TimeZone, Utc};
use db::models::coding_agent_turn::ResumableAgentSession;
use serde_json::Value;

const MAX_NATIVE_SCAN_FILES: usize = 500;
const SESSION_FILE_METADATA_LINES: usize = 100;
const TITLE_MAX_CHARS: usize = 100;

#[derive(Debug, Default, Clone)]
struct NativeSessionDraft {
    agent_session_id: String,
    title: Option<String>,
    last_used_at: Option<DateTime<Utc>>,
    cwd: Option<PathBuf>,
}

impl NativeSessionDraft {
    fn update_title(&mut self, title: Option<String>) {
        if let Some(title) = title.and_then(normalize_title) {
            self.title = Some(title);
        }
    }

    fn update_time(&mut self, timestamp: Option<DateTime<Utc>>) {
        let Some(timestamp) = timestamp else {
            return;
        };

        if self
            .last_used_at
            .is_none_or(|existing| timestamp > existing)
        {
            self.last_used_at = Some(timestamp);
        }
    }

    fn update_cwd(&mut self, cwd: Option<PathBuf>) {
        if let Some(cwd) = cwd {
            self.cwd = Some(cwd);
        }
    }
}

pub fn list_native_resumable_agent_sessions(
    executor: &str,
    since: DateTime<Utc>,
    limit: usize,
    workspace_scope: &[PathBuf],
    allow_unknown_cwd: bool,
) -> Vec<ResumableAgentSession> {
    let normalized_executor = executor.trim().replace('-', "_").to_ascii_uppercase();

    let drafts = match normalized_executor.as_str() {
        "CODEX" => list_codex_sessions(),
        "CLAUDE_CODE" => list_claude_sessions(),
        _ => return Vec::new(),
    };

    finalize_sessions(drafts, since, limit, workspace_scope, allow_unknown_cwd)
}

fn list_codex_sessions() -> HashMap<String, NativeSessionDraft> {
    let Some(codex_home) = executors::executors::codex::codex_home() else {
        return HashMap::new();
    };

    let mut drafts = HashMap::new();

    read_codex_history(&codex_home.join("history.jsonl"), &mut drafts);
    read_codex_session_index(&codex_home.join("session_index.jsonl"), &mut drafts);
    read_codex_session_files(&codex_home.join("sessions"), &mut drafts);

    drafts
}

fn read_codex_history(path: &Path, drafts: &mut HashMap<String, NativeSessionDraft>) {
    for value in read_jsonl_values(path, None) {
        let Some(session_id) = string_field(&value, "session_id") else {
            continue;
        };

        let timestamp = datetime_field(&value, "ts");
        let title = string_field(&value, "text").map(ToOwned::to_owned);
        update_draft(drafts, session_id, timestamp, title, None);
    }
}

fn read_codex_session_index(path: &Path, drafts: &mut HashMap<String, NativeSessionDraft>) {
    for value in read_jsonl_values(path, None) {
        let Some(session_id) = string_field(&value, "id")
            .or_else(|| string_field(&value, "session_id"))
            .or_else(|| string_field(&value, "thread_id"))
        else {
            continue;
        };

        let timestamp =
            datetime_field(&value, "updated_at").or_else(|| datetime_field(&value, "created_at"));
        let title = string_field(&value, "thread_name")
            .or_else(|| string_field(&value, "title"))
            .map(ToOwned::to_owned);
        update_draft(drafts, session_id, timestamp, title, None);
    }
}

fn read_codex_session_files(root: &Path, drafts: &mut HashMap<String, NativeSessionDraft>) {
    for (path, modified_at) in collect_jsonl_files(root, 4)
        .into_iter()
        .take(MAX_NATIVE_SCAN_FILES)
    {
        let mut session_id = None;
        let mut cwd = None;
        let mut title = None;

        for value in read_jsonl_values(&path, Some(SESSION_FILE_METADATA_LINES)) {
            if session_id.is_none() {
                session_id = value
                    .pointer("/payload/session_id")
                    .and_then(Value::as_str)
                    .or_else(|| value.pointer("/payload/id").and_then(Value::as_str))
                    .or_else(|| value.pointer("/payload/thread_id").and_then(Value::as_str))
                    .or_else(|| string_field(&value, "session_id"))
                    .or_else(|| string_field(&value, "id"))
                    .or_else(|| string_field(&value, "thread_id"))
                    .map(ToOwned::to_owned);
            }

            if cwd.is_none() {
                cwd = value
                    .pointer("/payload/cwd")
                    .and_then(Value::as_str)
                    .or_else(|| string_field(&value, "cwd"))
                    .map(PathBuf::from);
            }

            if title.is_none() {
                title = value
                    .pointer("/payload/message/content")
                    .and_then(text_from_content_value);
            }

            if session_id.is_some() && cwd.is_some() && title.is_some() {
                break;
            }
        }

        let Some(session_id) = session_id else {
            continue;
        };

        update_draft(drafts, &session_id, Some(modified_at), title, cwd);
    }
}

fn list_claude_sessions() -> HashMap<String, NativeSessionDraft> {
    let Some(claude_home) = home_dir().map(|home| home.join(".claude")) else {
        return HashMap::new();
    };

    let mut drafts = HashMap::new();

    read_claude_history(&claude_home.join("history.jsonl"), &mut drafts);
    read_claude_project_files(&claude_home.join("projects"), &mut drafts);

    drafts
}

fn read_claude_history(path: &Path, drafts: &mut HashMap<String, NativeSessionDraft>) {
    for value in read_jsonl_values(path, None) {
        let Some(session_id) =
            string_field(&value, "sessionId").or_else(|| string_field(&value, "session_id"))
        else {
            continue;
        };

        let timestamp =
            datetime_field(&value, "timestamp").or_else(|| datetime_field(&value, "ts"));
        let title = string_field(&value, "display")
            .or_else(|| string_field(&value, "prompt"))
            .map(ToOwned::to_owned);
        let cwd = string_field(&value, "cwd")
            .or_else(|| {
                string_field(&value, "project").filter(|project| Path::new(project).is_absolute())
            })
            .map(PathBuf::from);

        update_draft(drafts, session_id, timestamp, title, cwd);
    }
}

fn read_claude_project_files(root: &Path, drafts: &mut HashMap<String, NativeSessionDraft>) {
    for (path, modified_at) in collect_jsonl_files(root, 2)
        .into_iter()
        .take(MAX_NATIVE_SCAN_FILES)
    {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if file_name.starts_with("agent-") {
            continue;
        }

        let mut session_id = path
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned);
        let mut cwd = None;
        let mut title = None;
        let mut timestamp = Some(modified_at);

        for value in read_jsonl_values(&path, Some(SESSION_FILE_METADATA_LINES)) {
            if session_id.is_none() {
                session_id = string_field(&value, "sessionId")
                    .or_else(|| string_field(&value, "session_id"))
                    .map(ToOwned::to_owned);
            }

            if cwd.is_none() {
                cwd = string_field(&value, "cwd").map(PathBuf::from);
            }

            if title.is_none() {
                title = value
                    .get("message")
                    .and_then(|message| {
                        (message.get("role").and_then(Value::as_str) == Some("user"))
                            .then(|| message.get("content"))
                            .flatten()
                    })
                    .and_then(text_from_content_value);
            }

            if let Some(parsed_timestamp) = datetime_field(&value, "timestamp") {
                timestamp = Some(parsed_timestamp);
            }

            if session_id.is_some() && cwd.is_some() && title.is_some() {
                break;
            }
        }

        let Some(session_id) = session_id else {
            continue;
        };

        update_draft(drafts, &session_id, timestamp, title, cwd);
    }
}

fn update_draft(
    drafts: &mut HashMap<String, NativeSessionDraft>,
    session_id: &str,
    timestamp: Option<DateTime<Utc>>,
    title: Option<String>,
    cwd: Option<PathBuf>,
) {
    let draft = drafts
        .entry(session_id.to_string())
        .or_insert_with(|| NativeSessionDraft {
            agent_session_id: session_id.to_string(),
            ..NativeSessionDraft::default()
        });

    draft.update_time(timestamp);
    draft.update_title(title);
    draft.update_cwd(cwd);
}

fn finalize_sessions(
    drafts: HashMap<String, NativeSessionDraft>,
    since: DateTime<Utc>,
    limit: usize,
    workspace_scope: &[PathBuf],
    allow_unknown_cwd: bool,
) -> Vec<ResumableAgentSession> {
    let mut sessions = drafts
        .into_values()
        .filter_map(|draft| {
            let last_used_at = draft.last_used_at?;
            if last_used_at < since
                || !matches_workspace_scope(
                    draft.cwd.as_deref(),
                    workspace_scope,
                    allow_unknown_cwd,
                )
            {
                return None;
            }

            Some(ResumableAgentSession {
                agent_session_id: draft.agent_session_id,
                title: draft
                    .title
                    .unwrap_or_else(|| "Untitled session".to_string()),
                last_used_at,
            })
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
    sessions.truncate(limit);
    sessions
}

fn matches_workspace_scope(
    cwd: Option<&Path>,
    workspace_scope: &[PathBuf],
    allow_unknown_cwd: bool,
) -> bool {
    if workspace_scope.is_empty() {
        return true;
    }

    let Some(cwd) = cwd else {
        return allow_unknown_cwd;
    };

    let cwd = normalize_path_for_match(cwd);
    workspace_scope
        .iter()
        .map(|path| normalize_path_for_match(path))
        .any(|scope| cwd.starts_with(&scope) || scope.starts_with(&cwd))
}

fn normalize_path_for_match(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn collect_jsonl_files(root: &Path, max_depth: usize) -> Vec<(PathBuf, DateTime<Utc>)> {
    let mut files = Vec::new();
    collect_jsonl_files_inner(root, 0, max_depth, &mut files);
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files
}

fn collect_jsonl_files_inner(
    path: &Path,
    depth: usize,
    max_depth: usize,
    files: &mut Vec<(PathBuf, DateTime<Utc>)>,
) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            if depth < max_depth {
                collect_jsonl_files_inner(&path, depth + 1, max_depth, files);
            }
            continue;
        }

        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }

        let modified_at = metadata
            .modified()
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(|_| DateTime::<Utc>::from(SystemTime::UNIX_EPOCH));
        files.push((path, modified_at));
    }
}

fn read_jsonl_values(path: &Path, max_lines: Option<usize>) -> Vec<Value> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };

    let mut values = Vec::new();
    for (idx, line) in BufReader::new(file).lines().enumerate() {
        if max_lines.is_some_and(|max| idx >= max) {
            break;
        }

        let Ok(line) = line else {
            continue;
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(line) {
            Ok(value) => values.push(value),
            Err(err) => {
                tracing::debug!(
                    "Skipping malformed native agent history line in {}: {}",
                    path.display(),
                    err
                );
            }
        }
    }

    values
}

fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn datetime_field(value: &Value, field: &str) -> Option<DateTime<Utc>> {
    value.get(field).and_then(parse_datetime_value)
}

fn text_from_content_value(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    let texts = content
        .as_array()?
        .iter()
        .filter_map(|part| {
            let part_type = part.get("type").and_then(Value::as_str);
            if part_type.is_some_and(|kind| kind != "text") {
                return None;
            }
            part.get("text")
                .or_else(|| part.get("content"))
                .and_then(Value::as_str)
        })
        .collect::<Vec<_>>();

    if texts.is_empty() {
        None
    } else {
        Some(texts.join(" "))
    }
}

fn normalize_title(title: String) -> Option<String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return None;
    }

    let truncated = title.chars().take(TITLE_MAX_CHARS).collect::<String>();
    if title.chars().count() > TITLE_MAX_CHARS {
        Some(format!("{}...", truncated))
    } else {
        Some(truncated)
    }
}

fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

fn parse_datetime_value(value: &Value) -> Option<DateTime<Utc>> {
    if let Some(timestamp) = value.as_str() {
        return parse_datetime(timestamp);
    }

    if let Some(timestamp) = value.as_i64() {
        return parse_unix_timestamp_i128(timestamp.into());
    }

    if let Some(timestamp) = value.as_u64() {
        return parse_unix_timestamp_i128(i128::from(timestamp));
    }

    value.as_f64().and_then(parse_unix_timestamp_f64)
}

fn parse_unix_timestamp_i128(timestamp: i128) -> Option<DateTime<Utc>> {
    const MILLIS_THRESHOLD: i128 = 10_000_000_000;

    let (seconds, nanos) = if timestamp <= -MILLIS_THRESHOLD || timestamp >= MILLIS_THRESHOLD {
        let seconds = timestamp.div_euclid(1_000);
        let millis = timestamp.rem_euclid(1_000);
        (seconds, (millis * 1_000_000) as u32)
    } else {
        (timestamp, 0)
    };

    let seconds = i64::try_from(seconds).ok()?;
    Utc.timestamp_opt(seconds, nanos).single()
}

fn parse_unix_timestamp_f64(timestamp: f64) -> Option<DateTime<Utc>> {
    const MILLIS_THRESHOLD: f64 = 10_000_000_000.0;

    if !timestamp.is_finite() {
        return None;
    }

    let timestamp = if timestamp.abs() >= MILLIS_THRESHOLD {
        timestamp / 1_000.0
    } else {
        timestamp
    };
    let seconds = timestamp.floor();

    if seconds < i64::MIN as f64 || seconds > i64::MAX as f64 {
        return None;
    }

    let mut seconds = seconds as i64;
    let mut nanos = ((timestamp - seconds as f64) * 1_000_000_000.0).round() as u32;
    if nanos == 1_000_000_000 {
        seconds = seconds.checked_add(1)?;
        nanos = 0;
    }

    Utc.timestamp_opt(seconds, nanos).single()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            Some(PathBuf::from(format!(
                "{}{}",
                drive.to_string_lossy(),
                path.to_string_lossy()
            )))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_malformed_jsonl_lines() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("history.jsonl");
        fs::write(
            &path,
            "{\"session_id\":\"one\",\"ts\":\"2026-07-06T00:00:00Z\",\"text\":\"Hello\"}\nnot-json\n",
        )
        .expect("write jsonl");

        let values = read_jsonl_values(&path, None);

        assert_eq!(values.len(), 1);
        assert_eq!(string_field(&values[0], "session_id"), Some("one"));
    }

    #[test]
    fn parses_numeric_unix_timestamps() {
        assert_eq!(
            parse_datetime_value(&serde_json::json!(1_783_340_712)),
            Utc.timestamp_opt(1_783_340_712, 0).single()
        );
        assert_eq!(
            parse_datetime_value(&serde_json::json!(1_783_340_712_123i64)),
            Utc.timestamp_opt(1_783_340_712, 123_000_000).single()
        );
    }

    #[test]
    fn codex_history_accepts_numeric_ts() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("history.jsonl");
        fs::write(
            &path,
            "{\"session_id\":\"one\",\"ts\":1783340712,\"text\":\"Hello\"}\n",
        )
        .expect("write jsonl");

        let mut drafts = HashMap::new();
        read_codex_history(&path, &mut drafts);

        let draft = drafts.get("one").expect("draft");
        assert_eq!(
            draft.last_used_at,
            Utc.timestamp_opt(1_783_340_712, 0).single()
        );
        assert_eq!(draft.title.as_deref(), Some("Hello"));
    }

    #[test]
    fn codex_session_files_accept_payload_session_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("rollout.jsonl");
        fs::write(
            &path,
            "{\"timestamp\":\"2026-07-06T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"native-session\",\"cwd\":\"C:/repo\"}}\n",
        )
        .expect("write jsonl");

        let mut drafts = HashMap::new();
        read_codex_session_files(dir.path(), &mut drafts);

        let draft = drafts.get("native-session").expect("draft");
        assert_eq!(draft.cwd.as_deref(), Some(Path::new("C:/repo")));
    }

    #[test]
    fn workspace_scope_matches_nested_paths_and_keeps_unknown_cwd() {
        let scope = vec![PathBuf::from("C:/repo")];

        assert!(matches_workspace_scope(
            Some(Path::new("C:/repo/packages/app")),
            &scope,
            true
        ));
        assert!(!matches_workspace_scope(
            Some(Path::new("C:/other/packages/app")),
            &scope,
            true
        ));
        assert!(matches_workspace_scope(None, &scope, true));
        assert!(!matches_workspace_scope(None, &scope, false));
    }
}
