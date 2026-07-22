use super::{
    CaptureProtocol, NormalizedAttachment, NormalizedMessage, NormalizedSection,
    NormalizedToolDefinition, ParsedContextRequest, SectionMetrics,
};
use crate::error::Result;
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn detect_protocol(path: &str, body: &Value) -> Option<CaptureProtocol> {
    if path.ends_with("/chat/completions")
        || body.get("messages").is_some() && body.get("frequency_penalty").is_some()
    {
        Some(CaptureProtocol::OpenAiChatCompletions)
    } else if path.ends_with("/responses")
        || body.get("input").is_some() && body.get("instructions").is_some()
    {
        Some(CaptureProtocol::OpenAiResponses)
    } else if path.ends_with("/messages")
        || body.get("system").is_some() && body.get("max_tokens").is_some()
    {
        Some(CaptureProtocol::AnthropicMessages)
    } else {
        None
    }
}

pub fn parse_context_request(
    protocol: CaptureProtocol,
    raw_body: &[u8],
    probe_nonce: &str,
) -> Result<ParsedContextRequest> {
    let root: Value = serde_json::from_slice(raw_body)?;
    let object = root.as_object().ok_or_else(|| {
        serde_json::Error::io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "captured request body must be a JSON object",
        ))
    })?;

    let mut system_blocks = Vec::new();
    let mut messages = Vec::new();
    let mut attachments = Vec::new();

    match protocol {
        CaptureProtocol::OpenAiChatCompletions => {
            parse_messages(
                object.get("messages"),
                probe_nonce,
                true,
                &mut system_blocks,
                &mut messages,
                &mut attachments,
            );
        }
        CaptureProtocol::OpenAiResponses => {
            push_system_value(
                object.get("instructions"),
                "instructions",
                probe_nonce,
                &mut system_blocks,
            );
            parse_messages(
                object.get("input"),
                probe_nonce,
                false,
                &mut system_blocks,
                &mut messages,
                &mut attachments,
            );
        }
        CaptureProtocol::AnthropicMessages => {
            push_system_value(
                object.get("system"),
                "system",
                probe_nonce,
                &mut system_blocks,
            );
            parse_messages(
                object.get("messages"),
                probe_nonce,
                false,
                &mut system_blocks,
                &mut messages,
                &mut attachments,
            );
        }
    }

    let tool_definitions: Vec<NormalizedToolDefinition> = object
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| tools.iter().enumerate().map(normalize_tool).collect())
        .unwrap_or_default();

    let structural: HashSet<&str> = match protocol {
        CaptureProtocol::OpenAiChatCompletions => {
            ["model", "messages", "tools"].into_iter().collect()
        }
        CaptureProtocol::OpenAiResponses => ["model", "instructions", "input", "tools"]
            .into_iter()
            .collect(),
        CaptureProtocol::AnthropicMessages => ["model", "system", "messages", "tools"]
            .into_iter()
            .collect(),
    };
    let known_controls: HashSet<&str> = [
        "temperature",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "parallel_tool_calls",
        "stream",
        "stream_options",
        "max_tokens",
        "max_output_tokens",
        "reasoning",
        "thinking",
        "text",
        "output_config",
        "prompt_cache_key",
        "store",
        "include",
        "tool_choice",
        "metadata",
        "stop",
        "seed",
    ]
    .into_iter()
    .collect();
    let mut request_controls = Map::new();
    let mut unknown_fields = Map::new();
    for (key, value) in object {
        if known_controls.contains(key.as_str()) {
            request_controls.insert(key.clone(), value.clone());
        } else if !structural.contains(key.as_str()) {
            unknown_fields.insert(key.clone(), value.clone());
        }
    }

    let probe_message_indices: Vec<usize> = messages
        .iter()
        .filter(|message| message.is_probe)
        .map(|message| message.index)
        .collect();
    let controls_value = Value::Object(request_controls.clone());
    let (controls_bytes, controls_characters) = value_size(&controls_value);
    let section_metrics = SectionMetrics {
        system_bytes: system_blocks.iter().map(|item| item.bytes).sum(),
        system_characters: system_blocks.iter().map(|item| item.characters).sum(),
        message_bytes: messages.iter().map(|item| item.bytes).sum(),
        message_characters: messages.iter().map(|item| item.characters).sum(),
        tool_bytes: tool_definitions.iter().map(|item| item.bytes).sum(),
        tool_characters: tool_definitions.iter().map(|item| item.characters).sum(),
        controls_bytes,
        controls_characters,
    };

    let mut warnings = Vec::new();
    if system_blocks.is_empty() {
        warnings.push("No system instruction block was recognized in this payload.".to_string());
    }
    if probe_message_indices.is_empty() {
        warnings.push(
            "The versioned capture probe could not be identified after CLI transformation."
                .to_string(),
        );
    }

    Ok(ParsedContextRequest {
        model: object
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
        system_blocks,
        messages,
        tool_definitions,
        request_controls,
        attachments,
        probe_message_indices,
        unknown_fields,
        section_metrics,
        warnings,
    })
}

fn parse_messages(
    value: Option<&Value>,
    probe_nonce: &str,
    split_system_messages: bool,
    system_blocks: &mut Vec<NormalizedSection>,
    messages: &mut Vec<NormalizedMessage>,
    attachments: &mut Vec<NormalizedAttachment>,
) {
    let Some(items) = value.and_then(Value::as_array) else {
        return;
    };
    for (index, raw) in items.iter().enumerate() {
        let role = raw.get("role").and_then(Value::as_str).map(str::to_string);
        let item_type = raw.get("type").and_then(Value::as_str).map(str::to_string);
        let content = raw.get("content").cloned().unwrap_or_else(|| raw.clone());
        if split_system_messages && role.as_deref() == Some("system") {
            let (bytes, characters) = value_size(&content);
            system_blocks.push(NormalizedSection {
                index,
                source: "messages.system".to_string(),
                contains_probe: value_contains(&content, probe_nonce),
                content,
                bytes,
                characters,
            });
            continue;
        }
        collect_attachments(index, &content, attachments);
        let (bytes, characters) = value_size(raw);
        messages.push(NormalizedMessage {
            index,
            role,
            item_type,
            content,
            raw: raw.clone(),
            bytes,
            characters,
            is_probe: value_contains(raw, probe_nonce),
        });
    }
}

fn push_system_value(
    value: Option<&Value>,
    source: &str,
    probe_nonce: &str,
    output: &mut Vec<NormalizedSection>,
) {
    let Some(value) = value else { return };
    if let Some(items) = value.as_array() {
        for (index, item) in items.iter().enumerate() {
            let (bytes, characters) = value_size(item);
            output.push(NormalizedSection {
                index,
                source: source.to_string(),
                content: item.clone(),
                bytes,
                characters,
                contains_probe: value_contains(item, probe_nonce),
            });
        }
    } else {
        let (bytes, characters) = value_size(value);
        output.push(NormalizedSection {
            index: 0,
            source: source.to_string(),
            content: value.clone(),
            bytes,
            characters,
            contains_probe: value_contains(value, probe_nonce),
        });
    }
}

fn normalize_tool((index, raw): (usize, &Value)) -> NormalizedToolDefinition {
    let function = raw.get("function").unwrap_or(raw);
    let schema = function
        .get("parameters")
        .or_else(|| function.get("input_schema"))
        .or_else(|| raw.get("input_schema"))
        .cloned();
    let (bytes, characters) = value_size(raw);
    NormalizedToolDefinition {
        index,
        name: function
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string),
        description: function
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        schema,
        raw: raw.clone(),
        bytes,
        characters,
    }
}

fn collect_attachments(
    message_index: usize,
    content: &Value,
    output: &mut Vec<NormalizedAttachment>,
) {
    let Some(items) = content.as_array() else {
        return;
    };
    for (content_index, item) in items.iter().enumerate() {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or_default();
        if matches!(
            kind,
            "image" | "image_url" | "input_image" | "document" | "input_file" | "file"
        ) {
            let (bytes, characters) = value_size(item);
            output.push(NormalizedAttachment {
                message_index,
                content_index: Some(content_index),
                kind: kind.to_string(),
                raw: item.clone(),
                bytes,
                characters,
            });
        }
    }
}

fn value_contains(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(value) => value.contains(needle),
        Value::Array(values) => values.iter().any(|value| value_contains(value, needle)),
        Value::Object(values) => values.values().any(|value| value_contains(value, needle)),
        _ => false,
    }
}

fn value_size(value: &Value) -> (u64, u64) {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    (serialized.len() as u64, serialized.chars().count() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONCE: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn parses_chat_without_discarding_unknown_fields() {
        let body = format!(
            r#"{{"model":"gpt-4.1","messages":[{{"role":"system","content":"rules"}},{{"role":"user","content":"[TracePilot context capture {NONCE}]"}}],"tools":[{{"type":"function","function":{{"name":"shell","description":"run","parameters":{{"type":"object"}}}}}}],"stream":true,"future":{{"kept":true}}}}"#
        );
        let parsed = parse_context_request(
            CaptureProtocol::OpenAiChatCompletions,
            body.as_bytes(),
            NONCE,
        )
        .expect("fixture should parse");
        assert_eq!(parsed.system_blocks.len(), 1);
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.probe_message_indices, vec![1]);
        assert_eq!(parsed.tool_definitions[0].name.as_deref(), Some("shell"));
        assert!(parsed.unknown_fields.contains_key("future"));
        assert_eq!(
            parsed.request_controls.get("stream"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn parses_responses_and_anthropic_shapes() {
        let responses = format!(
            r#"{{"model":"gpt-5","instructions":"rules","input":[{{"role":"user","content":[{{"type":"input_text","text":"{NONCE}"}}]}}],"tools":[]}}"#
        );
        let parsed = parse_context_request(
            CaptureProtocol::OpenAiResponses,
            responses.as_bytes(),
            NONCE,
        )
        .expect("responses fixture should parse");
        assert_eq!(parsed.system_blocks.len(), 1);
        assert!(parsed.messages[0].is_probe);

        let anthropic = format!(
            r#"{{"model":"claude","max_tokens":100,"system":[{{"type":"text","text":"rules"}}],"messages":[{{"role":"user","content":"{NONCE}"}}],"tools":[]}}"#
        );
        let parsed = parse_context_request(
            CaptureProtocol::AnthropicMessages,
            anthropic.as_bytes(),
            NONCE,
        )
        .expect("anthropic fixture should parse");
        assert_eq!(parsed.system_blocks.len(), 1);
        assert!(parsed.messages[0].is_probe);
    }

    #[test]
    fn detects_protocol_from_operation_path() {
        let body = Value::Object(Map::new());
        assert_eq!(
            detect_protocol("/nonce/v1/responses", &body),
            Some(CaptureProtocol::OpenAiResponses)
        );
        assert_eq!(
            detect_protocol("/nonce/v1/messages", &body),
            Some(CaptureProtocol::AnthropicMessages)
        );
        assert_eq!(
            detect_protocol("/nonce/v1/chat/completions", &body),
            Some(CaptureProtocol::OpenAiChatCompletions)
        );
    }

    #[test]
    fn preserves_mixed_responses_items_and_classifies_current_controls() {
        let body = format!(
            r#"{{"model":"gpt-5","instructions":"rules","input":[{{"type":"message","role":"user","content":[{{"type":"input_text","text":"{NONCE}"}},{{"type":"input_image","image_url":"data:image/png;base64,AA=="}}]}},{{"type":"function_call","name":"shell","call_id":"1","arguments":"{{}}"}},{{"type":"function_call_output","call_id":"1","output":"ok"}},{{"type":"custom_tool_call","name":"patch","call_id":"2","input":"x"}},{{"type":"custom_tool_call_output","call_id":"2","output":"done"}}],"tools":[],"text":{{"verbosity":"low"}},"output_config":{{"effort":"medium"}}}}"#
        );
        let parsed =
            parse_context_request(CaptureProtocol::OpenAiResponses, body.as_bytes(), NONCE)
                .expect("responses fixture should parse");
        assert_eq!(parsed.messages.len(), 5);
        assert_eq!(parsed.attachments.len(), 1);
        assert_eq!(parsed.attachments[0].kind, "input_image");
        assert!(parsed.request_controls.contains_key("text"));
        assert!(parsed.request_controls.contains_key("output_config"));
        assert!(!parsed.unknown_fields.contains_key("text"));
    }

    #[test]
    fn preserves_anthropic_tool_use_and_result_blocks() {
        let body = format!(
            r#"{{"model":"claude","max_tokens":100,"system":[{{"type":"text","text":"rules"}},{{"type":"text","text":"more rules"}}],"messages":[{{"role":"assistant","content":[{{"type":"tool_use","id":"1","name":"shell","input":{{}}}}]}},{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"1","content":"ok"}},{{"type":"text","text":"{NONCE}"}}]}}],"tools":[]}}"#
        );
        let parsed =
            parse_context_request(CaptureProtocol::AnthropicMessages, body.as_bytes(), NONCE)
                .expect("anthropic fixture should parse");
        assert_eq!(parsed.system_blocks.len(), 2);
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].content[0]["type"], "tool_use");
        assert_eq!(parsed.messages[1].content[0]["type"], "tool_result");
        assert!(parsed.messages[1].is_probe);
    }
}
