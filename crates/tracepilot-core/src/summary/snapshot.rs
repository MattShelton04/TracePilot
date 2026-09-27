//! Strict summary loading for durable indexes. UI loading remains best effort.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::parsing::events::load_event_snapshot;
use crate::parsing::snapshot::{FileFingerprint, check_cancelled, ensure_unchanged};

use super::artifacts::apply_artifact_flags;
use super::enrichment::apply_event_enrichment;
use super::types::SessionLoadResult;
use super::workspace::load_workspace_summary_strict;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionFingerprint {
    pub workspace: Option<FileFingerprint>,
    pub events: Option<FileFingerprint>,
}

impl SessionFingerprint {
    pub fn read(session_dir: &Path) -> Result<Self> {
        Ok(Self {
            workspace: FileFingerprint::read(&session_dir.join("workspace.yaml"))?,
            events: FileFingerprint::read(&session_dir.join("events.jsonl"))?,
        })
    }
}

/// Successful results certify completeness and carry the pre-read identity.
/// Failures, including changing files, are retried on the next index pass.
pub fn load_session_snapshot(
    session_dir: &Path,
    is_cancelled: &impl Fn() -> bool,
) -> Result<(SessionLoadResult, SessionFingerprint)> {
    check_cancelled(is_cancelled)?;
    let fingerprint = SessionFingerprint::read(session_dir)?;
    let mut summary = load_workspace_summary_strict(session_dir)?;
    let snapshot = load_event_snapshot(&session_dir.join("events.jsonl"), is_cancelled)?;
    let (typed_events, turns, diagnostics) = if let Some(parsed) = snapshot.parsed {
        summary.has_events = true;
        let turns = apply_event_enrichment(&mut summary, &parsed.events);
        (Some(parsed.events), Some(turns), Some(parsed.diagnostics))
    } else {
        (None, None, None)
    };
    check_cancelled(is_cancelled)?;
    apply_artifact_flags(&mut summary, session_dir);
    ensure_unchanged(
        &fingerprint,
        &SessionFingerprint::read(session_dir)?,
        session_dir,
    )?;
    Ok((
        SessionLoadResult {
            summary,
            typed_events,
            turns,
            diagnostics,
        },
        fingerprint,
    ))
}
