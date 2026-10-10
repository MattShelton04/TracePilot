//! Recent export previews, reused while the session's files are unchanged.
//!
//! The preview panel refetches on every option change, so toggling an option
//! back renders the same session again. An entry is served only while the
//! session's source fingerprint (the session caches' `source_version`) and
//! every other file the export read are unchanged, so a growing live session
//! or an edited plan is rendered afresh.

use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError};

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
}

#[cfg(test)]
#[path = "preview_cache_tests.rs"]
mod tests;
