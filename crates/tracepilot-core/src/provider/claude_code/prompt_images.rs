//! Reading one pasted prompt image back from its transcript line.
//!
//! The reader drops image base64 before a line is kept, so a prompt's image
//! attachment only says where its block is (`line`, `pointer`). The
//! conversation asks for the picture when it shows that prompt, and only then
//! is that one line read again.

use std::io::BufReader;
use std::path::Path;

use serde_json::Value;

use super::reader::{MAX_LINE_BYTES, read_line_bounded};
use crate::error::{Result, TracePilotError};

/// A pasted image as written in the transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptImage {
    pub media_type: Option<String>,
    /// The block's base64 payload, undecoded.
    pub base64: String,
}

/// The image block at `pointer` in the record on 1-based `line` of `path`.
/// `pointer` must name a prompt block: `/message/content/<n>` or
/// `/attachment/prompt/<n>`. `None` when there is no image there.
pub fn read_prompt_image(path: &Path, line: usize, pointer: &str) -> Result<Option<PromptImage>> {
    if !is_prompt_block(pointer) {
        return Err(TracePilotError::ParseError {
            context: format!("Not a Claude Code prompt block: {pointer}"),
            source: None,
        });
    }
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    let mut reader = BufReader::new(file);
    let mut bytes = Vec::new();
    for _ in 0..line {
        bytes.clear();
        let read = read_line_bounded(&mut reader, &mut bytes, MAX_LINE_BYTES, &|| false)?;
        if read.consumed == 0 {
            return Ok(None);
        }
    }
    let Ok(record) = serde_json::from_slice::<Value>(&bytes) else {
        return Ok(None);
    };
    let Some(block) = record.pointer(pointer) else {
        return Ok(None);
    };
    if block.get("type").and_then(Value::as_str) != Some("image") {
        return Ok(None);
    }
    let base64 = block.pointer("/source/data").and_then(Value::as_str);
    Ok(base64.map(|data| PromptImage {
        media_type: block
            .pointer("/source/media_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        base64: data.to_string(),
    }))
}

fn is_prompt_block(pointer: &str) -> bool {
    ["/message/content/", "/attachment/prompt/"]
        .iter()
        .filter_map(|prefix| pointer.strip_prefix(prefix))
        .any(|index| !index.is_empty() && index.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tracepilot_test_support::claude::{Transcript, image, text, write_session};

    use super::*;

    #[test]
    fn reads_the_pasted_image_of_a_prompt_and_a_mid_turn_prompt() {
        let mut main = Transcript::main();
        main.user(
            json!({"message": {"role": "user", "content": [image("UFJPTVBU"), text("see this")]}}),
        );
        main.record(
            "attachment",
            json!({"attachment": {"type": "queued_command", "origin": {"kind": "human"},
                "prompt": [image("UVVFVUVE"), text("and this")]}}),
        );
        let files = write_session(&main, &[]);

        let prompt = read_prompt_image(&files.main, 1, "/message/content/0")
            .unwrap()
            .unwrap();
        assert_eq!(prompt.base64, "UFJPTVBU");
        assert_eq!(prompt.media_type.as_deref(), Some("image/png"));
        let queued = read_prompt_image(&files.main, 2, "/attachment/prompt/0")
            .unwrap()
            .unwrap();
        assert_eq!(queued.base64, "UVVFVUVE");

        assert_eq!(
            read_prompt_image(&files.main, 1, "/message/content/1").unwrap(),
            None,
            "a text block"
        );
        assert_eq!(
            read_prompt_image(&files.main, 9, "/message/content/0").unwrap(),
            None,
            "past the end"
        );
        for pointer in [
            "/message",
            "/toolUseResult/file",
            "/message/content/0/source",
            "/attachment/prompt/",
        ] {
            assert!(
                read_prompt_image(&files.main, 1, pointer).is_err(),
                "{pointer}"
            );
        }
    }
}
