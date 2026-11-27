//! Search content phase 1 extracts from the events it already parsed, so a
//! refresh that changed a few sessions parses each of them once.
//!
//! When every session's search content was fresh before phase 1, the
//! sessions phase 1 indexes are the only ones search can be missing: search
//! content comes from a subset of the files the session fingerprint covers.
//! Writing their rows then brings search up to date without listing every
//! session again or re-parsing the changed ones.

use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use tracepilot_core::parsing::snapshot::check_cancelled;
use tracepilot_core::provider::{SessionLocator, SessionProvider, SourceFingerprint};

use crate::Result;
use crate::index_db;
use crate::index_db::search_writer::{SearchContentRow, extract_search_content_cancellable};
use crate::index_db::session_writer::{PreparedSessionData, SessionIdentity};
use crate::indexing::PassCoverage;
use crate::indexing::scope::IndexScope;

/// Rows held for the handoff across a whole pass. A pass that would hold
/// more leaves its sessions to the search pass, which bounds its memory per
/// batch.
pub(crate) const MAX_HANDOFF_BYTES: usize = 32 * 1024 * 1024;

/// Per-row bookkeeping on top of its strings: the row itself and its
/// share of the vector.
const ROW_OVERHEAD_BYTES: usize = std::mem::size_of::<SearchContentRow>();

/// The search content of the sessions an incremental pass indexed, extracted
/// from the events it parsed. Write it with [`write_search_handoff`].
pub struct SearchHandoff {
    entries: Vec<HandoffEntry>,
}

impl std::fmt::Debug for SearchHandoff {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SearchHandoff")
            .field("sessions", &self.entries.len())
            .finish()
    }
}

impl SearchHandoff {
    /// Sessions whose search content it holds.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

struct HandoffEntry {
    provider: Arc<dyn SessionProvider>,
    locator: SessionLocator,
    rows: Vec<SearchContentRow>,
    /// The stored search fingerprint of the files the rows came from.
    search_fingerprint: String,
}

/// Search rows extracted alongside one session's metadata.
pub(super) struct ExtractedSearch {
    rows: Vec<SearchContentRow>,
    search_fingerprint: String,
}

/// Collects the rows of the sessions a pass wrote, within
/// [`MAX_HANDOFF_BYTES`]. Once over it, workers stop extracting and the pass
/// hands nothing off.
pub(super) struct HandoffCollector {
    entries: Mutex<Vec<HandoffEntry>>,
    bytes: AtomicUsize,
    overflowed: AtomicBool,
}

impl HandoffCollector {
    pub(super) fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            bytes: AtomicUsize::new(0),
            overflowed: AtomicBool::new(false),
        }
    }

    /// Load and analyze one session like [`prepare_snapshot`], and extract
    /// its search rows from the same events while the handoff has room.
    ///
    /// [`prepare_snapshot`]: crate::index_db::session_writer::prepare_snapshot
    pub(super) fn prepare(
        &self,
        provider: &Arc<dyn SessionProvider>,
        locator: &SessionLocator,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<(PreparedSessionData, Option<ExtractedSearch>)> {
        let snapshot = provider.load_snapshot(locator, true, is_cancelled)?;
        let search = if self.overflowed.load(Ordering::Relaxed) {
            None
        } else {
            self.extract(
                provider,
                locator,
                snapshot.events.as_deref(),
                &snapshot.fingerprint,
                is_cancelled,
            )?
        };
        let prepared = PreparedSessionData::from_snapshot(
            Arc::clone(provider),
            locator.clone(),
            snapshot,
            SessionIdentity::from_locator(locator),
        );
        Ok((prepared, search))
    }

    fn extract(
        &self,
        provider: &Arc<dyn SessionProvider>,
        locator: &SessionLocator,
        events: Option<&[tracepilot_core::parsing::events::TypedEvent]>,
        fingerprint: &SourceFingerprint,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<Option<ExtractedSearch>> {
        let rows = match events {
            Some(events) => extract_search_content_cancellable(&locator.id, events, &is_cancelled),
            None => Some(Vec::new()),
        };
        check_cancelled(&is_cancelled)?;
        let Some(rows) = rows else {
            return Ok(None);
        };
        let bytes = rows.iter().map(row_bytes).sum::<usize>();
        let held = self.bytes.fetch_add(bytes, Ordering::Relaxed) + bytes;
        if held > MAX_HANDOFF_BYTES {
            self.overflow();
            return Ok(None);
        }
        Ok(Some(ExtractedSearch {
            rows,
            search_fingerprint: provider.stored_search_fingerprint(fingerprint)?,
        }))
    }

    /// Keep the rows of a session whose metadata was written. A session
    /// written without rows means the handoff can't cover the pass.
    pub(super) fn keep(&self, prepared: &PreparedSessionData, search: Option<ExtractedSearch>) {
        match search {
            Some(search) if !self.overflowed.load(Ordering::Relaxed) => {
                let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
                entries.push(HandoffEntry {
                    provider: Arc::clone(&prepared.provider),
                    locator: prepared.locator.clone(),
                    rows: search.rows,
                    search_fingerprint: search.search_fingerprint,
                });
            }
            _ => self.overflow(),
        }
    }

    fn overflow(&self) {
        self.overflowed.store(true, Ordering::Relaxed);
    }

    /// The handoff, unless a session's rows were left out.
    pub(super) fn finish(self) -> Option<SearchHandoff> {
        let entries = self.entries.into_inner().unwrap_or_else(|e| e.into_inner());
        (!self.overflowed.into_inner()).then_some(SearchHandoff { entries })
    }
}

fn row_bytes(row: &SearchContentRow) -> usize {
    ROW_OVERHEAD_BYTES
        + row.session_id.len()
        + row.content.len()
        + row.tool_name.as_ref().map_or(0, String::len)
        + row.metadata_json.as_ref().map_or(0, String::len)
}

/// Write the search content an incremental pass handed off, one session per
/// transaction.
///
/// A session whose search files changed since phase 1 read them is left
/// for the search pass, and the result is then incomplete. Run it under the
/// search gate, so no search pass writes the same sessions meanwhile.
pub fn write_search_handoff(
    handoff: SearchHandoff,
    scope: &IndexScope,
    index_db_path: &Path,
    is_cancelled: impl Fn() -> bool,
) -> Result<PassCoverage> {
    let total = handoff.entries.len();
    if total == 0 {
        return Ok(PassCoverage::covered(0));
    }
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    let mut written = 0;
    for entry in &handoff.entries {
        let source = entry.provider.source();
        let stop = || is_cancelled() || !scope.is_current(source);
        if stop() {
            return Ok(PassCoverage::incomplete(written, 0));
        }
        match write_entry(&db, entry, &stop) {
            Ok(()) => written += 1,
            Err(error) => tracing::warn!(session_id = %entry.locator.id, error = %error,
                "Handed-off search content not written; leaving it to the search pass"),
        }
    }
    Ok(if written == total {
        PassCoverage::covered(written)
    } else {
        PassCoverage::incomplete(written, 0)
    })
}

fn write_entry(
    db: &index_db::IndexDb,
    entry: &HandoffEntry,
    stop: &impl Fn() -> bool,
) -> Result<()> {
    let current = entry
        .provider
        .stored_search_fingerprint(&entry.provider.fingerprint(&entry.locator)?)?;
    tracepilot_core::parsing::snapshot::ensure_unchanged(
        &entry.search_fingerprint,
        &current,
        &entry.locator.primary_path,
    )?;
    db.upsert_search_snapshot(
        entry.provider.source(),
        &entry.locator.id,
        &entry.rows,
        Some(&entry.search_fingerprint),
        stop,
    )?;
    Ok(())
}
