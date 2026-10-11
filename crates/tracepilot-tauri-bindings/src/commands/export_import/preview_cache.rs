//! Recent export previews, reused while the session's files are unchanged.
//!
//! The preview panel refetches on every option change, so toggling an option
//! back renders the same session again. An entry is served only while the
//! session's source fingerprint (the session caches' `source_version`) and
//! every other file the export read are unchanged, so a growing live session
//! or an edited plan is rendered afresh. A served preview carries the time it
//! was served as its export time, like a fresh render.

use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError};

use chrono::{DateTime, SecondsFormat, Utc};
use lru::LruCache;
use tracepilot_core::parsing::snapshot::FileFingerprint;
use tracepilot_core::paths::SessionPaths;
use tracepilot_core::provider::{PlanArtifact, ResolvedSession, SessionSource};

use super::sources::ExportSession;
use crate::types::ExportPreviewResult;

const CAPACITY: NonZeroUsize = NonZeroUsize::new(8).expect("nonzero");
/// Larger previews are not kept, bounding the cache to a few megabytes.
const MAX_CACHED_BYTES: usize = 1024 * 1024;

pub(super) static PREVIEW_CACHE: LazyLock<PreviewCache> = LazyLock::new(PreviewCache::new);

/// Forget every kept preview. Factory reset calls this so no rendered session
/// content outlives the reset.
pub(crate) fn clear_preview_cache() {
    PREVIEW_CACHE.clear();
}

/// One preview request: the session as resolved, plus every option.
#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct PreviewKey {
    pub session_id: String,
    pub primary_path: PathBuf,
    pub format: String,
    pub sections: Vec<String>,
    pub max_bytes: Option<usize>,
    pub detail: [Option<bool>; 6],
}

/// What a preview was rendered from, read before rendering.
pub(super) struct PreviewInputs {
    source_version: String,
    side_files: Vec<(PathBuf, Option<FileFingerprint>)>,
}

impl PreviewInputs {
    /// `None` when the inputs cannot all be fingerprinted; such a preview is
    /// rendered but not kept.
    pub(super) fn read(source_version: Option<String>, session: &ExportSession) -> Option<Self> {
        let side_files = side_files(session)?
            .into_iter()
            .map(|path| FileFingerprint::read(&path).ok().map(|print| (path, print)))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            source_version: source_version?,
            side_files,
        })
    }

    fn unchanged(&self, source_version: &str) -> bool {
        self.source_version == source_version
            && self.side_files.iter().all(|(path, fingerprint)| {
                FileFingerprint::read(path).is_ok_and(|now| now == *fingerprint)
            })
    }
}

/// The session's source fingerprint, as the session caches key it.
pub(super) fn source_version(session: &ResolvedSession) -> Option<String> {
    session
        .provider
        .fingerprint(&session.locator)
        .ok()
        .map(|fingerprint| fingerprint.source_version())
}

/// Files an export reads beyond the source fingerprint. `None` for a source
/// whose side files are not known here, so its previews are never kept.
fn side_files(session: &ExportSession) -> Option<Vec<PathBuf>> {
    match session {
        ExportSession::Directory(dir) => Some(copilot_side_files(dir)),
        ExportSession::Provider {
            source: SessionSource::ClaudeCode,
            artifacts,
            ..
        } => Some(match &artifacts.plan {
            Some(PlanArtifact::File(path)) => vec![path.clone()],
            _ => Vec::new(),
        }),
        ExportSession::Provider { .. } => None,
    }
}

/// Plan, todos database and its WAL, the checkpoint index and files, and the
/// rewind index of a Copilot session directory.
fn copilot_side_files(dir: &Path) -> Vec<PathBuf> {
    let paths = SessionPaths::from_root(dir);
    let session_db = paths.session_db();
    let mut files = vec![
        paths.plan_md(),
        session_db.with_file_name("session.db-wal"),
        session_db,
        paths.checkpoints_index(),
        paths.rewind_snapshots_index(),
    ];
    if let Ok(entries) = std::fs::read_dir(paths.checkpoints_dir()) {
        files.extend(
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
                .map(|entry| entry.path()),
        );
    }
    files.sort();
    files.dedup();
    files
}

pub(super) struct PreviewCache {
    entries: Mutex<LruCache<PreviewKey, (PreviewInputs, ExportPreviewResult)>>,
}

impl PreviewCache {
    pub(super) fn new() -> Self {
        Self {
            entries: Mutex::new(LruCache::new(CAPACITY)),
        }
    }

    /// The cached preview, if nothing it was rendered from has changed.
    pub(super) fn get(
        &self,
        key: &PreviewKey,
        source_version: &str,
    ) -> Option<ExportPreviewResult> {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let (inputs, result) = entries.get(key)?;
        if inputs.unchanged(source_version) {
            return Some(result.clone());
        }
        entries.pop(key);
        None
    }

    pub(super) fn insert(
        &self,
        key: PreviewKey,
        inputs: PreviewInputs,
        result: &ExportPreviewResult,
    ) {
        if result.content.len() > MAX_CACHED_BYTES {
            return;
        }
        self.entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .put(key, (inputs, result.clone()));
    }

    fn clear(&self) {
        self.entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }
}

/// `preview` with its export time set to `now`, as a fresh render would show.
/// Only the timestamp changes: the JSON content hash covers the sessions, not
/// the header. A preview truncated before its timestamp is left as it is.
pub(super) fn with_exported_at(
    mut preview: ExportPreviewResult,
    now: DateTime<Utc>,
) -> ExportPreviewResult {
    let Some((start, end, stamp)) = exported_at_span(&preview, now) else {
        return preview;
    };
    preview.estimated_size_bytes =
        (preview.estimated_size_bytes + stamp.len()).saturating_sub(end - start);
    preview.content.replace_range(start..end, &stamp);
    preview
}

/// The byte range of the header's export time in `preview`, and `now` in the
/// same notation. JSON writes the archive header first, serialized by serde;
/// Markdown writes it in the "Exported by" line, to the second.
fn exported_at_span(
    preview: &ExportPreviewResult,
    now: DateTime<Utc>,
) -> Option<(usize, usize, String)> {
    let content = &preview.content;
    let (header, open, close, stamp) = match preview.format.to_lowercase().as_str() {
        "json" => {
            let quoted = serde_json::to_string(&now).ok()?;
            (
                0,
                "\"exportedAt\": \"",
                "\"",
                quoted.trim_matches('"').to_string(),
            )
        }
        "markdown" | "md" => (
            content.find("> Exported by [")?,
            ") on ",
            " · Schema v",
            now.to_rfc3339_opts(SecondsFormat::Secs, true),
        ),
        _ => return None,
    };
    let start = header + content[header..].find(open)? + open.len();
    let end = start + content[start..].find(close)?;
    // Never splice across lines: a truncated header has no timestamp to patch.
    if content[start..end].contains('\n') {
        return None;
    }
    Some((start, end, stamp))
}

/// Seeds and inspects [`PREVIEW_CACHE`] for other modules' tests.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    fn key(session_id: &str) -> PreviewKey {
        PreviewKey {
            session_id: session_id.to_string(),
            primary_path: PathBuf::new(),
            format: "json".into(),
            sections: Vec::new(),
            max_bytes: None,
            detail: [None; 6],
        }
    }

    pub(crate) fn seed(session_id: &str) {
        let inputs = PreviewInputs {
            source_version: "v1".into(),
            side_files: Vec::new(),
        };
        let preview = ExportPreviewResult {
            content: "{}".into(),
            format: "json".into(),
            estimated_size_bytes: 2,
            section_count: 0,
        };
        PREVIEW_CACHE.insert(key(session_id), inputs, &preview);
    }

    pub(crate) fn is_cached(session_id: &str) -> bool {
        PREVIEW_CACHE.get(&key(session_id), "v1").is_some()
    }
}

#[cfg(test)]
#[path = "preview_cache_tests.rs"]
mod tests;
