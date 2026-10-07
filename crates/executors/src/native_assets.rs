//! Provider-native asset roots and conservative, lossless Cordis patch edits.
//!
//! Discovery never executes YAML tags, expressions, profile imports or CLIs.
//! The editor only changes selected block-mapping fields; unsupported YAML
//! shapes fail closed instead of being flattened by a YAML serializer.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value};

fn configured_path(name: &str, home: &Path) -> Option<PathBuf> {
    let value = std::env::var_os(name)?;
    let text = value.to_string_lossy();
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if text == "~" {
        return Some(home.to_path_buf());
    }
    if let Some(relative) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        return Some(home.join(relative));
    }
    Some(PathBuf::from(text))
}

pub(crate) fn opencode_root_for(home: &Path) -> PathBuf {
    configured_path("XDG_CONFIG_HOME", home)
        .unwrap_or_else(|| home.join(".config"))
        .join("opencode")
}

pub(crate) fn opencode_asset_root_for(home: &Path) -> PathBuf {
    configured_path("OPENCODE_CONFIG_DIR", home).unwrap_or_else(|| opencode_root_for(home))
}

pub(crate) fn opencode_config_roots(home: &Path) -> Vec<PathBuf> {
    let mut roots = vec![opencode_root_for(home)];
    if let Some(root) = configured_path("OPENCODE_CONFIG_DIR", home) {
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots
}

pub(crate) fn opencode_config_candidates(root: &Path, legacy: bool) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if legacy {
        candidates.push(root.join("config.json"));
    }
    candidates.extend([root.join("opencode.json"), root.join("opencode.jsonc")]);
    candidates
}

pub(crate) fn opencode_write_target(root: &Path, legacy: bool) -> PathBuf {
    opencode_config_candidates(root, legacy)
        .into_iter()
        .rev()
        .find(|path| path.is_file())
        .unwrap_or_else(|| root.join("opencode.jsonc"))
}

pub(crate) fn opencode_custom_config(home: &Path) -> Option<PathBuf> {
    configured_path("OPENCODE_CONFIG", home)
}

pub(crate) fn opencode_auth_path(home: &Path) -> PathBuf {
    configured_path("XDG_DATA_HOME", home)
        .unwrap_or_else(|| home.join(".local/share"))
        .join("opencode/auth.json")
}

pub(crate) fn deepseek_home_for(home: &Path) -> PathBuf {
    configured_path("DSH_HOME", home).unwrap_or_else(|| home.join(".dsh"))
}

pub(crate) fn deepseek_agents_home_for(home: &Path) -> PathBuf {
    configured_path("DSH_AGENTS_HOME", home).unwrap_or_else(|| home.join(".agents"))
}

pub(crate) fn deepseek_project_root(project: &Path) -> &Path {
    project
        .ancestors()
        .find(|ancestor| ancestor.join(".git").exists())
        .unwrap_or(project)
}

/// Convert JSON explicitly before YAML serialization. Serializing JSON Values
/// directly can emit serde_json's private number marker when a workspace
/// dependency enables arbitrary_precision.
pub(crate) fn json_to_yaml(value: &Value) -> Result<serde_yaml::Value, String> {
    Ok(match value {
        Value::Null => serde_yaml::Value::Null,
        Value::Bool(value) => serde_yaml::Value::Bool(*value),
        Value::Number(value) => {
            let number = if let Some(value) = value.as_i64() {
                serde_yaml::Number::from(value)
            } else if let Some(value) = value.as_u64() {
                serde_yaml::Number::from(value)
            } else if let Some(value) = value.as_f64() {
                serde_yaml::Number::from(value)
            } else {
                return Err("number cannot be represented in YAML".to_string());
            };
            serde_yaml::Value::Number(number)
        }
        Value::String(value) => serde_yaml::Value::String(value.clone()),
        Value::Array(values) => serde_yaml::Value::Sequence(
            values
                .iter()
                .map(json_to_yaml)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Value::Object(object) => serde_yaml::Value::Mapping(
            object
                .iter()
                .map(|(key, value)| {
                    Ok((serde_yaml::Value::String(key.clone()), json_to_yaml(value)?))
                })
                .collect::<Result<serde_yaml::Mapping, String>>()?,
        ),
    })
}

pub(crate) fn parse_yaml(content: &str) -> Result<Value, String> {
    if content.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    // Do not expand aliases or accept tagged executable values. An unsupported
    // document remains untouched, including its exact source text.
    reject_yaml_node_extensions(content)?;
    let yaml: serde_yaml::Value =
        serde_yaml::from_str(content).map_err(|_| "invalid native YAML".to_string())?;
    reject_yaml_extensions(&yaml)?;
    serde_json::to_value(yaml).map_err(|_| "unsupported native YAML value".to_string())
}

fn reject_yaml_node_extensions(content: &str) -> Result<(), String> {
    // serde_yaml resolves aliases and can discard explicit !! tags before
    // constructing Value. Reject both lexically first; quoted strings and
    // comments remain literal data.
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    for line in content.lines() {
        let mut previous = ' ';
        for character in line.chars() {
            if escaped {
                escaped = false;
                previous = character;
                continue;
            }
            if double && character == '\\' {
                escaped = true;
                continue;
            }
            if character == '\'' && !double {
                single = !single;
            }
            if character == '"' && !single {
                double = !double;
            }
            if !single && !double {
                if character == '#' && previous.is_whitespace() {
                    break;
                }
                if matches!(character, '&' | '*')
                    && (previous.is_whitespace() || "[:,{-".contains(previous))
                {
                    return Err("YAML aliases and anchors are read-only".into());
                }
                if character == '!' && (previous.is_whitespace() || "[:,{-".contains(previous)) {
                    return Err("tagged/executable YAML is read-only".into());
                }
            }
            previous = character;
        }
    }
    Ok(())
}

fn reject_yaml_extensions(value: &serde_yaml::Value) -> Result<(), String> {
    match value {
        serde_yaml::Value::Tagged(_) => Err("tagged/executable YAML is read-only".into()),
        serde_yaml::Value::Mapping(mapping) => {
            for (key, value) in mapping {
                if !matches!(key, serde_yaml::Value::String(_)) {
                    return Err("non-string YAML keys are read-only".into());
                }
                reject_yaml_extensions(value)?;
            }
            Ok(())
        }
        serde_yaml::Value::Sequence(items) => {
            for item in items {
                reject_yaml_extensions(item)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

pub(crate) fn parse_cordis_patch(content: &str) -> Result<Value, String> {
    if content.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = parse_yaml(content)?;
    let rows = raw
        .as_array()
        .ok_or("Cordis configuration must be a patch list")?;
    let mut plugins = Map::new();
    for row in rows {
        apply_cordis_row(row, &mut plugins)?;
    }
    Ok(Value::Object(plugins))
}

fn apply_cordis_row(row: &Value, plugins: &mut Map<String, Value>) -> Result<(), String> {
    let row = row
        .as_object()
        .ok_or("Cordis patch rows must be mappings")?;
    if row.contains_key("include") || row.contains_key("extends") {
        return Err("composed Cordis patches are read-only".into());
    }
    if let Some(insert) = row.get("insert") {
        for plugin in insert.as_array().ok_or("Cordis insert must be a list")? {
            apply_cordis_row(plugin, plugins)?;
        }
    }
    if let Some(id) = row.get("id") {
        let id = id
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("Cordis row requires a string id")?;
        let target = plugins
            .entry(id.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        let target = target.as_object_mut().ok_or("invalid Cordis row")?;
        // Cordis replaces whole config objects, not nested keys. Other row
        // fields remain inherited unless this patch explicitly supplies them.
        for (key, value) in row {
            if key != "insert" {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    Ok(())
}

pub(crate) fn cordis_mcp_config(content: &str) -> Result<Value, String> {
    let rows = parse_cordis_patch(content)?;
    let mut servers = Map::new();
    for (id, row) in rows.as_object().ok_or("invalid Cordis patch")? {
        let Some(config) = row.get("config").and_then(Value::as_object) else {
            continue;
        };
        let is_mcp = row.get("name").and_then(Value::as_str) == Some("@deepseek-ai/dsh-mcp-client")
            || (config.contains_key("serverName") && config.contains_key("transport"));
        if !is_mcp {
            continue;
        }
        let name = config
            .get("serverName")
            .and_then(Value::as_str)
            .ok_or("MCP plugin requires serverName")?;
        let mut native = config.clone();
        native.insert("__dsh_id".into(), Value::String(id.clone()));
        native.insert(
            "__dsh_disabled".into(),
            row.get("disabled").cloned().unwrap_or(Value::Bool(false)),
        );
        if let Some(name) = row.get("name") {
            native.insert("__dsh_plugin".into(), name.clone());
        }
        if servers
            .insert(name.to_string(), Value::Object(native))
            .is_some()
        {
            return Err(
                "duplicate MCP names in Cordis patch; use native configuration to resolve them"
                    .into(),
            );
        }
    }
    Ok(serde_json::json!({"mcpServers": servers}))
}

#[derive(Clone)]
struct PluginSpan {
    id: String,
    start: usize,
    end: usize,
    indent: usize,
}

fn sequence_spans(content: &str, indent: usize) -> Vec<(usize, usize)> {
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        if line.starts_with(&format!("{}- ", " ".repeat(indent))) {
            starts.push(offset);
        }
        offset += line.len();
    }
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            (
                *start,
                starts.get(index + 1).copied().unwrap_or(content.len()),
            )
        })
        .collect()
}

fn plugin_spans(content: &str) -> Result<Vec<PluginSpan>, String> {
    let mut result = Vec::new();
    for (start, end) in sequence_spans(content, 0) {
        let block = &content[start..end];
        let raw = parse_yaml(block)?;
        let row = raw
            .as_array()
            .and_then(|items| items.first())
            .ok_or("unsupported Cordis row syntax")?;
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            result.push(PluginSpan {
                id: id.to_string(),
                start,
                end,
                indent: 0,
            });
        }
        if let Some(insert) = row.get("insert") {
            if !insert.is_array()
                || !block
                    .lines()
                    .next()
                    .is_some_and(|line| line.trim() == "- insert:")
            {
                return Err("non-block Cordis insert is read-only".into());
            }
            let child_indent = block
                .lines()
                .skip(1)
                .find_map(|line| {
                    let trimmed = line.trim_start();
                    trimmed
                        .starts_with("- ")
                        .then_some(line.len() - trimmed.len())
                })
                .ok_or("empty Cordis insert is read-only")?;
            for (child_start, child_end) in sequence_spans(block, child_indent) {
                let child = &block[child_start..child_end];
                let deindented = child
                    .lines()
                    .map(|line| line.get(child_indent..).unwrap_or(""))
                    .collect::<Vec<_>>()
                    .join("\n");
                let raw = parse_yaml(&deindented)?;
                let row = raw
                    .as_array()
                    .and_then(|items| items.first())
                    .ok_or("invalid inserted Cordis row")?;
                if let Some(id) = row.get("id").and_then(Value::as_str) {
                    result.push(PluginSpan {
                        id: id.to_string(),
                        start: start + child_start,
                        end: start + child_end,
                        indent: child_indent,
                    });
                }
            }
        }
    }
    Ok(result)
}

pub(crate) fn render_cordis_patch(current: &str, desired: &Value) -> Result<String, String> {
    let before = parse_cordis_patch(current)?;
    let before = before.as_object().ok_or("invalid Cordis projection")?;
    let desired = desired.as_object().ok_or("invalid Cordis projection")?;
    let spans = plugin_spans(current)?;
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let mut additions = Vec::new();
    for (id, row) in desired {
        if before.get(id) == Some(row) {
            continue;
        }
        if let Some(span) = spans.iter().rev().find(|span| &span.id == id) {
            let block = &current[span.start..span.end];
            let mut mapping = block.to_string();
            let dash = span.indent;
            mapping.replace_range(dash..dash + 2, "  ");
            let raw = parse_yaml(&deindent(&mapping, span.indent + 2))?;
            let mut after = raw.clone();
            let after_map = after
                .as_object_mut()
                .ok_or("Cordis plugin must be a mapping")?;
            // Emit the complete effective config whenever editing it. Native
            // later-row replacement must not drop keys inherited in this file.
            for (key, value) in row.as_object().ok_or("invalid Cordis plugin")? {
                if before.get(id).and_then(|row| row.get(key)) != Some(value) {
                    after_map.insert(key.clone(), value.clone());
                }
            }
            for key in before
                .get(id)
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|row| row.keys())
            {
                if row.get(key).is_none() {
                    after_map.remove(key);
                }
            }
            let rendered = render_yaml_mapping(&mapping, &raw, &after, span.indent + 2)?;
            let mut rendered = rendered;
            if rendered.len() <= dash + 1 {
                return Err("empty native plugin mapping".into());
            }
            rendered.replace_range(dash..dash + 2, "- ");
            edits.push((span.start, span.end, rendered));
        } else {
            additions.push(row.clone());
        }
    }
    for id in before.keys().filter(|id| !desired.contains_key(*id)) {
        for span in spans.iter().filter(|span| &span.id == id) {
            // Remove only this native plugin's row, keeping surrounding patch
            // rows and comments. If it is the sole insert, remove its container.
            let mut start = span.start;
            if span.indent > 0 {
                if let Some((parent_start, parent_end)) = sequence_spans(current, 0)
                    .into_iter()
                    .find(|(start, end)| *start < span.start && *end >= span.end)
                {
                    let sibling_count = spans
                        .iter()
                        .filter(|other| other.start > parent_start && other.end <= parent_end)
                        .count();
                    if sibling_count == 1 {
                        start = parent_start;
                    }
                }
            }
            edits.push((
                start,
                span.end,
                preserved_comments(&current[start..span.end]),
            ));
        }
    }
    edits.sort_by_key(|(start, _, _)| *start);
    if edits.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err("overlapping native plugin edits are unsupported".into());
    }
    let mut output = current.to_string();
    for (start, end, replacement) in edits.into_iter().rev() {
        output.replace_range(start..end, &replacement);
    }
    if !additions.is_empty() {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        let mut rows = Vec::new();
        for row in additions {
            if row.get("name").is_some() {
                rows.push(serde_json::json!({"insert": [row]}));
            } else {
                rows.push(row);
            }
        }
        let insertion = serde_yaml::to_string(&json_to_yaml(&Value::Array(rows))?)
            .map_err(|_| "could not encode native plugin".to_string())?;
        output.push_str(&insertion);
    }
    if parse_cordis_patch(&output)? != Value::Object(desired.clone()) {
        return Err("native Cordis edit did not round-trip".into());
    }
    Ok(output)
}

fn deindent(content: &str, indent: usize) -> String {
    content
        .split_inclusive('\n')
        .map(|line| {
            if line.trim().is_empty() {
                line
            } else {
                line.get(indent..).unwrap_or(line)
            }
        })
        .collect()
}

fn preserved_comments(content: &str) -> String {
    content
        .split_inclusive('\n')
        .filter(|line| line.trim_start().starts_with('#'))
        .collect()
}

/// Targeted block mapping edits used for Cordis plugin configs and the native
/// credential document. Quoted values/flow arrays are emitted as JSON, which is
/// also valid YAML. Unchanged fields, comments and line endings are retained.
pub(crate) fn render_yaml_mapping(
    current: &str,
    before: &Value,
    desired: &Value,
    indent: usize,
) -> Result<String, String> {
    let before = before.as_object().ok_or("native YAML mapping required")?;
    let desired = desired.as_object().ok_or("native YAML mapping required")?;
    let mut output = current.to_string();
    for key in before.keys().chain(desired.keys()) {
        if before.get(key) == desired.get(key) {
            continue;
        }
        // Duplicates from the chained key iterator are idempotent, but avoid
        // editing twice by comparing against the current parsed projection.
        let parsed = parse_yaml(&deindent(&output, indent))?;
        if parsed.get(key) == desired.get(key) {
            continue;
        }
        output = replace_yaml_key(&output, indent, key, desired.get(key))?;
    }
    if parse_yaml(&deindent(&output, indent))? != Value::Object(desired.clone()) {
        return Err("native YAML mapping edit did not round-trip".into());
    }
    Ok(output)
}

fn mapping_keys(
    content: &str,
    indent: usize,
) -> Result<BTreeMap<String, (usize, usize, usize)>, String> {
    let mut keys = BTreeMap::new();
    let mut offset = 0;
    let mut starts: Vec<(String, usize, usize)> = Vec::new();
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if line.len() - trimmed.len() == indent
            && !trimmed.trim().is_empty()
            && !trimmed.starts_with('#')
        {
            let Some(colon) = yaml_colon(trimmed) else {
                return Err("non-block native YAML mapping is read-only".into());
            };
            let key: String = serde_yaml::from_str(trimmed[..colon].trim())
                .map_err(|_| "unsupported YAML key".to_string())?;
            starts.push((key, offset, offset + line.len()));
        }
        offset += line.len();
    }
    for (index, (key, start, line_end)) in starts.iter().enumerate() {
        let end = starts
            .get(index + 1)
            .map(|(_, start, _)| *start)
            .unwrap_or(content.len());
        if keys.insert(key.clone(), (*start, *line_end, end)).is_some() {
            return Err("duplicate native YAML keys".into());
        }
    }
    Ok(keys)
}

fn yaml_colon(text: &str) -> Option<usize> {
    let mut quote = None;
    let mut escaped = false;
    for (offset, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '\'' || ch == '"' {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(ch);
            }
        } else if ch == ':'
            && quote.is_none()
            && text[offset + 1..]
                .chars()
                .next()
                .is_none_or(char::is_whitespace)
        {
            return Some(offset);
        }
    }
    None
}

fn inline_comment(text: &str) -> Option<&str> {
    let mut quote = None;
    let mut escaped = false;
    let mut previous_whitespace = true;
    for (offset, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            previous_whitespace = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '\'' || ch == '"' {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(ch);
            }
        }
        if ch == '#' && quote.is_none() && previous_whitespace {
            return Some(text[offset..].trim_end_matches(['\r', '\n']));
        }
        previous_whitespace = ch.is_whitespace();
    }
    None
}

fn replace_yaml_key(
    content: &str,
    indent: usize,
    key: &str,
    desired: Option<&Value>,
) -> Result<String, String> {
    let keys = mapping_keys(content, indent)?;
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let existing = keys.get(key).copied();
    let mut output = content.to_string();
    if let (Some((start, line_end, end)), Some(value)) = (existing, desired) {
        let first = &content[start..line_end];
        let colon = yaml_colon(first.trim_start()).ok_or("invalid YAML mapping field")? + indent;
        let suffix = first[colon + 1..].trim();
        let old = parse_yaml(&deindent(content, indent))?;
        if let (Some(old), Some(new)) = (old.get(key).and_then(Value::as_object), value.as_object())
        {
            if new.is_empty() {
                let comment = inline_comment(&first[colon + 1..])
                    .map(|comment| format!(" {comment}"))
                    .unwrap_or_default();
                let replacement = format!(
                    "{}{}: {{}}{comment}{newline}{}",
                    " ".repeat(indent),
                    &first[indent..colon],
                    preserved_comments(&content[line_end..end])
                );
                output.replace_range(start..end, &replacement);
                return Ok(output);
            }
            if suffix.is_empty() || suffix.starts_with('#') {
                let body = &content[line_end..end];
                let child_indent = body
                    .lines()
                    .find(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
                    .map(|line| line.len() - line.trim_start().len())
                    .unwrap_or(indent + 2);
                let rendered = render_yaml_mapping(
                    body,
                    &Value::Object(old.clone()),
                    &Value::Object(new.clone()),
                    child_indent,
                )?;
                output.replace_range(line_end..end, &rendered);
                return Ok(output);
            }
            return Err("flow-mapping edits are read-only; convert the selected mapping to block YAML first".into());
        }
        let comment = inline_comment(&first[colon + 1..])
            .map(|comment| format!(" {comment}"))
            .unwrap_or_default();
        let encoded =
            serde_json::to_string(value).map_err(|_| "invalid YAML replacement".to_string())?;
        let replacement = format!(
            "{}{}: {encoded}{comment}{newline}{}",
            " ".repeat(indent),
            &first[indent..colon],
            preserved_comments(&content[line_end..end])
        );
        output.replace_range(start..end, &replacement);
    } else if let Some((start, _, end)) = existing {
        output.replace_range(start..end, &preserved_comments(&content[start..end]));
    } else if let Some(value) = desired {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push_str(newline);
        }
        let encoded_key = serde_json::to_string(key).map_err(|_| "invalid YAML key".to_string())?;
        if let Some(object) = value.as_object().filter(|object| !object.is_empty()) {
            output.push_str(&format!("{}{encoded_key}:{newline}", " ".repeat(indent)));
            let body = render_yaml_mapping(
                "",
                &Value::Object(Map::new()),
                &Value::Object(object.clone()),
                indent + 2,
            )?;
            output.push_str(&body);
        } else {
            let encoded =
                serde_json::to_string(value).map_err(|_| "invalid YAML value".to_string())?;
            output.push_str(&format!(
                "{}{encoded_key}: {encoded}{newline}",
                " ".repeat(indent)
            ));
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cordis_targeted_edits_preserve_comments_and_unknown_plugins() {
        let source = "# document\n- id: acp\n  config:\n    provider: deepseek-official\n    model: old # selected\n    sessionListPageSize: 25\n- insert:\n    - id: vk-mcp-demo\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: demo\n        transport: stdio\n        command: npx\n        args: [example]\n        timeout: 30 # keep\n- id: unrelated\n  config:\n    extension: keep\n";
        let mut desired = parse_cordis_patch(source).unwrap();
        desired["acp"]["config"]["model"] = Value::String("new".into());
        desired["vk-mcp-demo"]["disabled"] = Value::Bool(true);
        let output = render_cordis_patch(source, &desired).unwrap();
        assert!(output.contains("# document"));
        assert!(output.contains("# selected"));
        assert!(output.contains("timeout: 30 # keep"));
        assert!(output.contains("sessionListPageSize: 25"));
        assert!(output.contains("extension: keep"));
        assert_eq!(parse_cordis_patch(&output).unwrap(), desired);
    }

    #[test]
    fn cordis_rejects_executable_tags_and_preserves_whole_row_replacement() {
        for tag in ["!expr", "!!js", "!!str", "!<tag:example.test,2026:expr>"] {
            assert!(
                parse_cordis_patch(&format!("- id: acp\n  config: {tag} 'process.env'\n")).is_err()
            );
        }
        assert!(parse_yaml("literal: '!!js is data' # !!js is a comment\n").is_ok());
        let parsed = parse_cordis_patch("- id: acp\n  config: {provider: first, model: old}\n- id: acp\n  config: {model: new}\n").unwrap();
        assert!(parsed["acp"]["config"].get("provider").is_none());
        assert_eq!(parsed["acp"]["config"]["model"], "new");
        assert!(parse_yaml("refs: &credentials {KEY: value}\ncopy: *credentials\n").is_err());
        assert!(parse_yaml("literal: '*not-an-alias'\n").is_ok());
    }

    #[test]
    fn native_credential_mapping_preserves_records_and_unrelated_refs() {
        let source = "version: 1\nrefs:\n  DEEPSEEK_API_KEY: old # credential\n  OTHER: keep\nrecords: {} # grants\n";
        let before = parse_yaml(source).unwrap();
        let mut desired = before.clone();
        desired["refs"]["DEEPSEEK_API_KEY"] = Value::String("new".into());
        let output = render_yaml_mapping(source, &before, &desired, 0).unwrap();
        assert!(output.contains("# credential"));
        assert!(output.contains("OTHER: keep"));
        assert!(output.contains("records: {} # grants"));
    }

    #[test]
    fn cordis_new_override_preserves_native_numbers() {
        let source = "# native home\n- id: unrelated\n  config:\n    keep: true\n";
        let mut desired = parse_cordis_patch(source).unwrap();
        desired["acp"] = serde_json::json!({"id": "acp", "config": {
            "provider": "route", "model": "model", "sessionListPageSize": 23,
            "ratio": 0.5, "exactInteger": 9007199254740993_u64
        }});
        let output = render_cordis_patch(source, &desired).unwrap();
        assert_eq!(parse_cordis_patch(&output).unwrap(), desired);
        assert!(output.starts_with(source));
        assert!(!output.contains("$serde_json::private::Number"));
    }

    #[test]
    fn empty_native_mapping_and_new_override_are_not_null_or_inserted_plugins() {
        let source = "refs:\n  KEY: value\nrecords: {} # retained\n";
        let before = parse_yaml(source).unwrap();
        let mut desired = before.clone();
        desired["refs"] = serde_json::json!({});
        let output = render_yaml_mapping(source, &before, &desired, 0).unwrap();
        assert_eq!(parse_yaml(&output).unwrap(), desired);
        let row = serde_json::json!({"acp": {"id": "acp", "config": {"provider": "route", "model": "model"}}});
        let rendered = render_cordis_patch("", &row).unwrap();
        assert!(!rendered.contains("insert:"));
        assert_eq!(parse_cordis_patch(&rendered).unwrap(), row);
    }
}
