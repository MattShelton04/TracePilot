//! Streaming JSONL reader for Claude Code transcripts.
//!
//! Lines are read in file order, never re-sorted by timestamp
//! (data-comparison rule 1). A malformed line is skipped and counted. A last
//! line without its newline is a live file mid-append: it is kept if it
//! parses and otherwise counted as a partial tail, even when it ends inside a
//! UTF-8 sequence. Image base64 is replaced before a line is retained.
//!
//! Memory is bounded per line: a line longer than [`MAX_LINE_BYTES`] is
//! skipped without being buffered and counted as oversized.

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

/// The longest line kept. The longest real line seen is 1.3 MiB, an image
/// Read whose base64 is stored twice (data-comparison rule 8).
pub(super) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

/// Read in large blocks: transcripts run to tens of MiB, and the default
/// 8 KiB buffer made one read call per 8 KiB.
const READ_BUFFER_BYTES: usize = 256 * 1024;

pub(super) fn read_jsonl(
    path: &Path,
    is_cancelled: &impl Fn() -> bool,
    diagnostics: &mut ClaudeDiagnostics,
) -> Result<Vec<Line>> {
    read_jsonl_bounded(path, MAX_LINE_BYTES, is_cancelled, diagnostics)
}

pub(super) fn read_jsonl_bounded(
    path: &Path,
    max_line_bytes: usize,
    is_cancelled: &impl Fn() -> bool,
    diagnostics: &mut ClaudeDiagnostics,
) -> Result<Vec<Line>> {
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
    let mut bytes = Vec::new();
    let mut lines = Vec::new();
    let mut number = 0;
    loop {
        check_cancelled(is_cancelled)?;
        bytes.clear();
        let read = read_line_bounded(&mut reader, &mut bytes, max_line_bytes, is_cancelled)?;
        if read.consumed == 0 {
            break;
        }
        number += 1;
        if read.oversized {
            tracing::warn!(
                line = number,
                bytes = read.consumed,
                "Skipping oversized Claude Code line"
            );
            diagnostics.oversized_lines += 1;
            continue;
        }
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

struct LineRead {
    consumed: usize,
    oversized: bool,
}

/// Read one line, newline included, into `bytes`. A line longer than `max`
/// is consumed without being kept, leaving `bytes` empty. Cancellation is
/// checked between buffer fills, so a huge line cannot delay it.
fn read_line_bounded(
    reader: &mut impl BufRead,
    bytes: &mut Vec<u8>,
    max: usize,
    is_cancelled: &impl Fn() -> bool,
) -> Result<LineRead> {
    let mut read = LineRead {
        consumed: 0,
        oversized: false,
    };
    loop {
        if read.consumed > 0 {
            check_cancelled(is_cancelled)?;
        }
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(read);
        }
        let newline = find_newline(available);
        let chunk = &available[..newline.map_or(available.len(), |i| i + 1)];
        if !read.oversized {
            if bytes.len() + chunk.len() > max {
                read.oversized = true;
                *bytes = Vec::new();
            } else {
                bytes.extend_from_slice(chunk);
            }
        }
        let n = chunk.len();
        reader.consume(n);
        read.consumed += n;
        if newline.is_some() {
            return Ok(read);
        }
    }
}

/// The index of the first `\n`. `skip_until` on a slice uses the standard
/// library's word-at-a-time search, several times faster than comparing
/// byte by byte; reading from a slice cannot fail.
fn find_newline(bytes: &[u8]) -> Option<usize> {
    let mut rest = bytes;
    let through = rest.skip_until(b'\n').unwrap_or(0);
    (through > 0 && bytes[through - 1] == b'\n').then(|| through - 1)
}

const OMITTED: &str = "[omitted by TracePilot]";

/// Replace image payloads and whole-file copies in place. Returns the number
/// of images replaced.
///
/// - `{"type":"image","source":{"data":…}}` blocks (prompts, Read results).
/// - Any `base64` string (`toolUseResult.file.base64` stores the image again).
/// - `toolUseResult.originalFile`: the full file before an Edit or Write;
///   `structuredPatch` carries the change.
/// - `toolUseResult.stdout` of a shell whose output is an image (`isImage`).
pub(super) fn sanitize(value: &mut Value) -> usize {
    let mut count = 0;
    if let Some(result) = value.get_mut("toolUseResult") {
        if let Some(original) = result
            .get_mut("originalFile")
            .filter(|original| original.is_string())
        {
            *original = Value::String(OMITTED.into());
        }
        if result.get("isImage").and_then(Value::as_bool) == Some(true)
            && let Some(stdout) = result.get_mut("stdout").filter(|out| out.is_string())
        {
            *stdout = Value::String(omitted_bytes(stdout));
            count += 1;
        }
    }
    count + sanitize_images(value)
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

#[cfg(test)]
mod tests {
    use super::{ClaudeDiagnostics, read_jsonl_bounded};

    fn record(n: usize, pad: usize) -> String {
        format!(
            "{{\"type\":\"user\",\"n\":{n},\"pad\":\"{}\"}}",
            "x".repeat(pad)
        )
    }

    #[test]
    fn lines_over_the_bound_are_skipped_without_buffering_and_counted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let body = [
            record(1, 10),
            record(2, 4096),
            record(3, 10),
            record(4, 4096), // an oversized partial tail: no newline
        ];
        std::fs::write(
            &path,
            format!("{}\n{}\n{}\n{}", body[0], body[1], body[2], body[3]),
        )
        .unwrap();
        let mut diagnostics = ClaudeDiagnostics::default();
        let lines = read_jsonl_bounded(&path, 1024, &|| false, &mut diagnostics).unwrap();
        let kept: Vec<_> = lines
            .iter()
            .map(|l| (l.line, l.value["n"].as_u64()))
            .collect();
        assert_eq!(kept, [(1, Some(1)), (3, Some(3))]);
        assert_eq!(diagnostics.oversized_lines, 2);
        assert_eq!(diagnostics.malformed_lines, 0);
        assert_eq!(diagnostics.partial_tails, 0);
    }

    /// The per-line check alone would run twice here (before the line and at
    /// EOF); cancellation must also land while one huge line drains.
    #[test]
    fn cancellation_interrupts_a_huge_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        std::fs::write(&path, format!("{}\n", record(1, 4 << 20))).unwrap();
        let checks = std::cell::Cell::new(0);
        let is_cancelled = || {
            checks.set(checks.get() + 1);
            checks.get() > 2
        };
        let mut diagnostics = ClaudeDiagnostics::default();
        let result = read_jsonl_bounded(&path, 1024, &is_cancelled, &mut diagnostics);
        let error = result.expect_err("cancelled mid-line");
        assert!(error.to_string().contains("cancelled"), "{error}");
        assert_eq!(
            checks.get(),
            3,
            "stopped at the first check inside the line"
        );
    }

    #[test]
    fn a_line_exactly_at_the_bound_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let line = format!("{}\n", record(1, 100));
        std::fs::write(&path, &line).unwrap();
        let mut diagnostics = ClaudeDiagnostics::default();
        let kept = read_jsonl_bounded(&path, line.len(), &|| false, &mut diagnostics).unwrap();
        assert_eq!(kept.len(), 1);
        let skipped = read_jsonl_bounded(&path, line.len() - 1, &|| false, &mut diagnostics);
        assert!(skipped.unwrap().is_empty());
        assert_eq!(diagnostics.oversized_lines, 1);
    }
}
