use std::path::Path;

use crate::error::{Result, TracePilotError};
use crate::parsing::snapshot::{FileFingerprint, check_cancelled, ensure_unchanged};

use super::{ParsedEvents, parse_typed_events_cancellable};

/// Only constructed after a complete parse and a stable source check.
pub struct EventSnapshot {
    pub parsed: Option<ParsedEvents>,
    pub fingerprint: Option<FileFingerprint>,
}

/// Load a complete event snapshot for persistence. Malformed JSONL remains
/// available to best-effort UI parsers but must not replace last-good indexes.
pub fn load_event_snapshot(path: &Path, is_cancelled: &impl Fn() -> bool) -> Result<EventSnapshot> {
    check_cancelled(is_cancelled)?;
    let fingerprint = FileFingerprint::read(path)?;
    let parsed = if fingerprint.is_some() {
        let parsed = parse_typed_events_cancellable(path, is_cancelled)?;
        if parsed.diagnostics.malformed_lines > 0
            || !parsed.diagnostics.deserialization_failures.is_empty()
        {
            return Err(TracePilotError::ParseError {
                context: format!("Incomplete event snapshot: {}", path.display()),
                source: None,
            });
        }
        Some(parsed)
    } else {
        None
    };
    ensure_unchanged(&fingerprint, &FileFingerprint::read(path)?, path)?;
    check_cancelled(is_cancelled)?;
    Ok(EventSnapshot {
        parsed,
        fingerprint,
    })
}
