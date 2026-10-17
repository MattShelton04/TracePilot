use std::path::Path;

use crate::error::{Result, TracePilotError};
use crate::parsing::snapshot::{FileFingerprint, check_cancelled, ensure_unchanged};

use super::{ParsedEvents, parse_typed_events_cancellable};

/// Only constructed after a whole-file parse and a stable source check.
pub struct EventSnapshot {
    pub parsed: Option<ParsedEvents>,
    pub fingerprint: Option<FileFingerprint>,
}

/// Load an event snapshot for persistence: every event that parses, and the
/// identity of the file as it was read.
///
/// Skipped lines (malformed, cut off or not UTF-8) are counted in
/// `parsed.diagnostics.malformed_lines` and do not fail the load. A crashed
/// CLI leaves such a line in the middle of a log for good, so refusing it
/// would keep the session out of the index forever. The fingerprint is taken
/// before reading and checked after it, so it describes exactly the bytes
/// read: finishing a line that was still being written changes it, and the
/// next index pass reads the file again.
///
/// A file with skipped lines and no event at all fails: it holds nothing to
/// recover, and failing keeps the last good index rows.
pub fn load_event_snapshot(path: &Path, is_cancelled: &impl Fn() -> bool) -> Result<EventSnapshot> {
    check_cancelled(is_cancelled)?;
    let fingerprint = FileFingerprint::read(path)?;
    let parsed = if fingerprint.is_some() {
        let parsed = parse_typed_events_cancellable(path, is_cancelled)?;
        if parsed.events.is_empty() && parsed.diagnostics.malformed_lines > 0 {
            return Err(TracePilotError::ParseError {
                context: format!("No readable event in {}", path.display()),
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
