//! Streaming JSONL reader for Claude Code transcripts.
//!
//! Lines are read in file order, never re-sorted by timestamp
//! (data-comparison rule 1). A malformed line is skipped and counted. A last
//! line without its newline is a live file mid-append: it is kept if it
//! parses and otherwise counted as a partial tail, even when it ends inside a
//! UTF-8 sequence. Image base64 is replaced before a line is retained.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;

use super::ClaudeDiagnostics;
use crate::error::{Result, TracePilotError};
use crate::parsing::events::parse_json_line_lenient;
use crate::parsing::snapshot::check_cancelled;

/// One parsed, sanitized record and its 1-based line number.
#[derive(Debug, Clone)]
pub(super) struct Line {
    pub(super) line: usize,
    pub(super) value: Arc<Value>,
}

pub(super) fn read_jsonl(
    path: &Path,
    is_cancelled: &impl Fn() -> bool,
    diagnostics: &mut ClaudeDiagnostics,
) -> Result<Vec<Line>> {
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    let mut reader = BufReader::new(file);
    let mut bytes = Vec::new();
    let mut lines = Vec::new();
    let mut number = 0;
    loop {
        check_cancelled(is_cancelled)?;
        bytes.clear();
        if reader.read_until(b'\n', &mut bytes)? == 0 {
            break;
        }
        number += 1;
        let complete = bytes.last() == Some(&b'\n');
        let parsed = std::str::from_utf8(&bytes)
            .ok()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(parse_json_line_lenient::<Value>);
        match parsed {
            None if std::str::from_utf8(&bytes).is_ok() => {} // blank line
            Some(Ok(mut value)) if value.is_object() => {
                diagnostics.sanitized_images += sanitize(&mut value);
                lines.push(Line {
                    line: number,
                    value: Arc::new(value),
                });
            }
            _ if !complete => diagnostics.partial_tails += 1,
            _ => {
                tracing::warn!(line = number, "Skipping malformed Claude Code line");
                diagnostics.malformed_lines += 1;
            }
        }
    }
    Ok(lines)
}

const OMITTED: &str = "[omitted by TracePilot]";

/// Replace image payloads and whole-file copies in place. Returns the number
/// of images replaced.
///
/// - `{"type":"image","source":{"data":…}}` blocks (prompts, Read results).
/// - Any `base64` string (`toolUseResult.file.base64` stores the image again).
/// - `toolUseResult.originalFile`: the full file before an Edit or Write;
///   `structuredPatch` carries the change.
pub(super) fn sanitize(value: &mut Value) -> usize {
    if let Some(original) = value
        .get_mut("toolUseResult")
        .and_then(|result| result.get_mut("originalFile"))
        .filter(|original| original.is_string())
    {
        *original = Value::String(OMITTED.into());
    }
    sanitize_images(value)
}

fn sanitize_images(value: &mut Value) -> usize {
    match value {
        Value::Object(map) => {
            let mut count = 0;
            if map.get("type").and_then(Value::as_str) == Some("image")
                && let Some(data) = map
                    .get_mut("source")
                    .and_then(|source| source.get_mut("data"))
                    .filter(|data| data.is_string())
            {
                *data = Value::String(omitted_bytes(data));
                count += 1;
            }
            if let Some(data) = map.get_mut("base64").filter(|data| data.is_string()) {
                *data = Value::String(omitted_bytes(data));
                count += 1;
            }
            count + map.values_mut().map(sanitize_images).sum::<usize>()
        }
        Value::Array(items) => items.iter_mut().map(sanitize_images).sum(),
        _ => 0,
    }
}

fn omitted_bytes(data: &Value) -> String {
    let len = data.as_str().map_or(0, str::len);
    format!("[image omitted by TracePilot: {len} base64 bytes]")
}
