//! Visible reasoning compatibility. Never decode or display opaque provider data.

use super::AssistantMessageData;
use std::borrow::Cow;

impl AssistantMessageData {
    /// Prefer the persisted visible text; newer Responses payloads can also carry
    /// public summaries inside provider-tagged reasoning blocks. This fallback is
    /// shared by conversation reconstruction and search to avoid divergent text.
    pub fn visible_reasoning(&self) -> Option<Cow<'_, str>> {
        if let Some(text) = self
            .reasoning_text
            .as_deref()
            .filter(|s| !s.trim().is_empty())
        {
            return Some(Cow::Borrowed(text));
        }
        let payload = self.reasoning_blocks.as_ref()?;
        if payload.get("provider")?.as_str()? != "openai-responses" {
            return None;
        }
        let mut summaries = Vec::new();
        for block in payload.get("blocks")?.as_array()? {
            if block.get("type").and_then(|v| v.as_str()) != Some("reasoning") {
                continue;
            }
            let Some(entries) = block.get("summary").and_then(|v| v.as_array()) else {
                continue;
            };
            for entry in entries {
                if entry.get("type").and_then(|v| v.as_str()) == Some("summary_text")
                    && let Some(text) = entry.get("text").and_then(|v| v.as_str())
                    && !text.trim().is_empty()
                {
                    summaries.push(text);
                }
            }
        }
        (!summaries.is_empty()).then(|| Cow::Owned(summaries.join("\n\n")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn message(blocks: Value) -> AssistantMessageData {
        AssistantMessageData {
            reasoning_blocks: Some(blocks),
            ..Default::default()
        }
    }

    #[test]
    fn visible_reasoning_prefers_original_text_and_falls_back_in_order() {
        let mut data = message(json!({"provider": "openai-responses", "blocks": [
            {"type": "reasoning", "summary": [
                {"type": "summary_text", "text": "**Checking inputs**\n\nDetails."},
                {"type": "summary_text", "text": " "},
                {"type": "summary_text", "text": "Second section."}
            ]},
            {"type": "reasoning", "summary": [{"type": "summary_text", "text": "Next block."}]}
        ]}));
        let expected = "**Checking inputs**\n\nDetails.\n\nSecond section.\n\nNext block.";
        assert_eq!(data.visible_reasoning().as_deref(), Some(expected));
        data.reasoning_text = Some("  \n".into());
        assert_eq!(data.visible_reasoning().as_deref(), Some(expected));
        data.reasoning_text = Some(" Original text and spacing. ".into());
        assert_eq!(
            data.visible_reasoning().as_deref(),
            Some(" Original text and spacing. ")
        );
    }

    #[test]
    fn visible_reasoning_ignores_opaque_unknown_and_malformed_data() {
        for payload in [
            Value::Null,
            json!([]),
            json!({"provider": "unknown", "blocks": []}),
            json!({"provider": "openai-responses", "blocks": "invalid"}),
            json!({"provider": "openai-responses", "blocks": [
                null, {"type": "reasoning", "encrypted_content": "opaque", "summary": []},
                {"type": "reasoning", "summary": "invalid"},
                {"type": "message", "summary": [{"type": "summary_text", "text": "wrong block"}]},
                {"type": "reasoning", "summary": [null,
                    {"type": "unknown", "text": "hidden"},
                    {"type": "summary_text", "text": 42},
                    {"type": "summary_text", "text": " "}]}
            ]}),
        ] {
            assert_eq!(message(payload).visible_reasoning(), None);
        }
        assert_eq!(AssistantMessageData::default().visible_reasoning(), None);
    }
}
