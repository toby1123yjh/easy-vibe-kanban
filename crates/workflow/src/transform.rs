use std::{error::Error, fmt};

use regex::Regex;

use crate::graph::{TransformMode, WorkflowNodeData};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformError {
    message: String,
}

impl TransformError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for TransformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for TransformError {}

pub fn apply_transform(data: &WorkflowNodeData, input: &str) -> Result<String, TransformError> {
    match data
        .mode
        .as_ref()
        .ok_or_else(|| TransformError::new("transform mode is required"))?
    {
        TransformMode::Template => apply_template(data, input),
        TransformMode::RegexExtract => apply_regex_extract(data, input),
        TransformMode::Truncate => apply_truncate(data, input),
    }
}

fn apply_template(data: &WorkflowNodeData, input: &str) -> Result<String, TransformError> {
    let template = data
        .template
        .as_deref()
        .ok_or_else(|| TransformError::new("template transform requires template text"))?;

    Ok(template
        .replace("{{input}}", input)
        .replace("{{upstream}}", input))
}

fn apply_regex_extract(data: &WorkflowNodeData, input: &str) -> Result<String, TransformError> {
    let pattern = data
        .regex
        .as_deref()
        .ok_or_else(|| TransformError::new("regex_extract transform requires regex"))?;
    let regex = Regex::new(pattern)
        .map_err(|err| TransformError::new(format!("invalid regex `{pattern}`: {err}")))?;
    let captures = regex
        .captures(input)
        .ok_or_else(|| TransformError::new("regex_extract transform found no match"))?;
    let capture = captures
        .get(1)
        .or_else(|| captures.get(0))
        .ok_or_else(|| TransformError::new("regex_extract transform found no capture"))?;

    Ok(capture.as_str().to_string())
}

fn apply_truncate(data: &WorkflowNodeData, input: &str) -> Result<String, TransformError> {
    let max_chars = data
        .max_chars
        .ok_or_else(|| TransformError::new("truncate transform requires max_chars"))?;

    Ok(input.chars().take(max_chars).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_transform_wraps_upstream_text() {
        let data = WorkflowNodeData {
            mode: Some(TransformMode::Template),
            template: Some("Review this:\n{{upstream}}".to_string()),
            ..WorkflowNodeData::default()
        };

        let output = apply_transform(&data, "hello").unwrap();

        assert_eq!(output, "Review this:\nhello");
    }

    #[test]
    fn regex_extract_returns_first_capture() {
        let data = WorkflowNodeData {
            mode: Some(TransformMode::RegexExtract),
            regex: Some("issue #(\\d+)".to_string()),
            ..WorkflowNodeData::default()
        };

        let output = apply_transform(&data, "fix issue #42 today").unwrap();

        assert_eq!(output, "42");
    }

    #[test]
    fn truncate_respects_character_limit() {
        let data = WorkflowNodeData {
            mode: Some(TransformMode::Truncate),
            max_chars: Some(4),
            ..WorkflowNodeData::default()
        };

        let output = apply_transform(&data, "aébcdef").unwrap();

        assert_eq!(output, "aébc");
    }
}
