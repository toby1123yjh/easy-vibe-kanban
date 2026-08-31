use serde_yaml::Value;

use super::AgentCommandError;

#[derive(Debug)]
pub(super) struct MarkdownCommand<'a> {
    pub(super) frontmatter: Option<&'a str>,
    pub(super) body: &'a str,
    pub(super) line_ending: &'static str,
}

pub(super) fn parse(content: &str) -> Result<MarkdownCommand<'_>, AgentCommandError> {
    let Some((frontmatter, body, line_ending)) = split_frontmatter(content)? else {
        return Ok(MarkdownCommand {
            frontmatter: None,
            body: content,
            line_ending: "\n",
        });
    };
    // Parse once here so every Markdown-backed provider rejects malformed YAML
    // consistently. Provider modules still own which native fields they read.
    let parsed = serde_yaml::from_str::<Value>(frontmatter).map_err(|error| {
        AgentCommandError::InvalidConfiguration(format!("invalid YAML frontmatter: {error}"))
    })?;
    if !frontmatter.trim().is_empty() && !parsed.is_mapping() {
        return Err(AgentCommandError::InvalidConfiguration(
            "YAML frontmatter must be a mapping".into(),
        ));
    }
    Ok(MarkdownCommand {
        frontmatter: Some(frontmatter),
        body,
        line_ending,
    })
}

pub(super) fn string_field(
    frontmatter: Option<&str>,
    key: &str,
) -> Result<Option<String>, AgentCommandError> {
    let Some(frontmatter) = frontmatter else {
        return Ok(None);
    };
    if frontmatter.trim().is_empty() {
        return Ok(None);
    }
    let parsed: Value = serde_yaml::from_str(frontmatter).map_err(|error| {
        AgentCommandError::InvalidConfiguration(format!("invalid YAML frontmatter: {error}"))
    })?;
    let mapping = parsed.as_mapping().ok_or_else(|| {
        AgentCommandError::InvalidConfiguration("YAML frontmatter must be a mapping".into())
    })?;
    mapping
        .get(Value::String(key.into()))
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                AgentCommandError::InvalidConfiguration(format!("command {key} must be a string"))
            })
        })
        .transpose()
}

pub(super) fn render(
    current_source: Option<&str>,
    fields: &[(&str, Option<&str>)],
    body: &str,
) -> Result<String, AgentCommandError> {
    for (key, value) in fields {
        if value.is_some_and(|value| value.contains(['\n', '\r'])) {
            return Err(AgentCommandError::InvalidConfiguration(format!(
                "command {key} must use one line"
            )));
        }
    }

    let existing = current_source.map(parse).transpose()?;
    let line_ending = existing
        .as_ref()
        .map(|command| command.line_ending)
        .unwrap_or("\n");
    let mut frontmatter = existing
        .as_ref()
        .and_then(|command| command.frontmatter)
        .unwrap_or("")
        .to_owned();
    for (key, value) in fields {
        frontmatter = update_string_field(&frontmatter, key, *value, line_ending)?;
    }
    if frontmatter.is_empty() {
        return Ok(body.to_owned());
    }
    Ok(format!(
        "---{line_ending}{frontmatter}{line_ending}---{line_ending}{body}"
    ))
}

fn split_frontmatter(
    content: &str,
) -> Result<Option<(&str, &str, &'static str)>, AgentCommandError> {
    let (line_ending, prefix_len) = if content.starts_with("---\r\n") {
        ("\r\n", 5)
    } else if content.starts_with("---\n") {
        ("\n", 4)
    } else {
        return Ok(None);
    };
    let remainder = &content[prefix_len..];
    let surrounded_marker = format!("{line_ending}---{line_ending}");
    let terminal_marker = format!("{line_ending}---");
    let (end, after_marker) = if remainder.starts_with(&format!("---{line_ending}")) {
        (prefix_len, prefix_len + 3 + line_ending.len())
    } else if remainder == "---" {
        (prefix_len, content.len())
    } else if let Some(relative_end) = remainder.find(&surrounded_marker) {
        let end = prefix_len + relative_end;
        (end, end + surrounded_marker.len())
    } else if remainder.ends_with(&terminal_marker) {
        let end = content.len() - terminal_marker.len();
        (end, content.len())
    } else {
        return Err(AgentCommandError::InvalidConfiguration(
            "unterminated YAML frontmatter".into(),
        ));
    };
    Ok(Some((
        &content[prefix_len..end],
        &content[after_marker..],
        line_ending,
    )))
}

fn update_string_field(
    frontmatter: &str,
    key: &str,
    value: Option<&str>,
    line_ending: &str,
) -> Result<String, AgentCommandError> {
    let mut lines: Vec<String> = if frontmatter.is_empty() {
        Vec::new()
    } else {
        frontmatter.split(line_ending).map(str::to_owned).collect()
    };
    let mut key_index = None;
    let mut continuation_end = None;
    for (index, line) in lines.iter().enumerate() {
        if is_top_level_key(line, key) {
            if key_index.is_some() {
                return Err(AgentCommandError::InvalidConfiguration(format!(
                    "command frontmatter contains duplicate {key} fields"
                )));
            }
            key_index = Some(index);
            let mut end = index + 1;
            while end < lines.len() && (lines[end].starts_with(' ') || lines[end].starts_with('\t'))
            {
                end += 1;
            }
            continuation_end = Some(end);
        }
    }
    let rendered = value
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| AgentCommandError::InvalidConfiguration(error.to_string()))?
        .map(|value| format!("{key}: {value}"));
    match (key_index, rendered) {
        (Some(index), Some(rendered)) => {
            lines.splice(index..continuation_end.unwrap_or(index + 1), [rendered]);
        }
        (Some(index), None) => {
            lines.drain(index..continuation_end.unwrap_or(index + 1));
        }
        (None, Some(rendered)) => lines.insert(0, rendered),
        (None, None) => {}
    }
    Ok(lines.join(line_ending))
}

fn is_top_level_key(line: &str, key: &str) -> bool {
    if line.trim_start() != line {
        return false;
    }
    serde_yaml::from_str::<Value>(line)
        .ok()
        .and_then(|value| value.as_mapping().cloned())
        .is_some_and(|mapping| mapping.contains_key(Value::String(key.into())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_delimiter_must_be_an_exact_line() {
        let error = parse("---\ndescription: test\n---not-a-marker\nbody").unwrap_err();
        assert!(matches!(error, AgentCommandError::InvalidConfiguration(_)));
    }

    #[test]
    fn frontmatter_must_be_a_mapping() {
        for source in ["---\n- one\n- two\n---\nbody", "---\nscalar\n---\nbody"] {
            let error = parse(source).unwrap_err();
            assert!(matches!(error, AgentCommandError::InvalidConfiguration(_)));
        }
    }

    #[test]
    fn targeted_update_recognizes_quoted_and_spaced_keys() {
        for source in [
            "---\n'description': old\ncustom: keep\n---\nbody",
            "---\ndescription : old\ncustom: keep\n---\nbody",
        ] {
            let rendered = render(Some(source), &[("description", Some("new"))], "body").unwrap();
            assert_eq!(rendered.matches("description").count(), 1);
            assert!(rendered.contains("description: \"new\""));
            assert!(rendered.contains("custom: keep"));
        }
    }

    #[test]
    fn duplicate_managed_keys_fail_closed() {
        let source = "---\ndescription: first\n'description': second\n---\nbody";
        let error = render(Some(source), &[("description", Some("new"))], "body").unwrap_err();
        assert!(matches!(error, AgentCommandError::InvalidConfiguration(_)));
    }
}
