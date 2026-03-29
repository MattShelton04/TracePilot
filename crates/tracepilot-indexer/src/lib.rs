//! tracepilot-indexer: Maintain a local index database for fast session search.
//!
//! Creates and incrementally updates `~/.copilot/tracepilot/index.db` with:
//! - Session metadata from workspace.yaml
//! - Shutdown metrics
//! - FTS5 full-text search over summaries and messages

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rayon::prelude::*;

/// Minimum interval between progress events to avoid flooding IPC.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(80);

pub mod error;
pub mod index_db;

pub use error::{IndexerError, Result};

pub use index_db::SessionIndexInfo;
pub use index_db::{SearchFacets, SearchFilters, SearchResult, SearchStats};
pub use index_db::search_reader::sanitize_fts_query;

/// Accumulated progress info emitted per session during indexing.
#[derive(Debug, Clone)]
pub struct IndexingProgress {
    pub current: usize,
    pub total: usize,
    /// Info about the session just processed (None if indexing failed for this session).
    pub session_info: Option<SessionIndexInfo>,
    /// Running totals across all successfully indexed sessions so far.
    pub running_tokens: u64,
    pub running_events: u64,
    pub running_repos: usize,
}

/// Tracks and emits throttled progress during indexing operations.
///
/// Accumulates running totals (tokens, events, repos) and emits progress
/// events at a controlled rate to avoid flooding IPC channels.
///
/// # Thread Safety
///
/// This type is `!Send` and must only be used on the main thread after
/// parallel parsing completes via Rayon. Do not attempt to share across threads.
///
/// # Progress Semantics
///
/// The `current` counter represents sessions that have been **fully processed**
/// (indexed or skipped). During incremental reindex staleness checks, sessions
/// identified for reindexing are NOT included in `current` until they are
/// actually indexed.
struct ProgressTracker {
    current: usize,
    total: usize,
    running_tokens: u64,
    running_events: u64,
    seen_repos: std::collections::HashSet<String>,
    last_emit: Instant,
    throttle: Duration,
}

impl ProgressTracker {
    /// Create a new tracker for indexing `total` sessions.
    #[inline]
    fn new(total: usize) -> Self {
        Self {
            current: 0,
            total,
            running_tokens: 0,
            running_events: 0,
            seen_repos: std::collections::HashSet::new(),
            last_emit: Instant::now(),
            throttle: PROGRESS_THROTTLE,
        }
    }

    /// Accumulate metrics from a successfully indexed session.
    ///
    /// Note: Sessions with `repository = None` are handled correctly.
    #[inline]
    fn accumulate(&mut self, info: &SessionIndexInfo) {
        self.running_tokens += info.total_tokens;
        self.running_events += info.event_count as u64;
        if let Some(ref repo) = info.repository {
            self.seen_repos.insert(repo.clone());
        }
    }

    /// Increment the current session counter.
    ///
    /// This should be called for every session processed, whether successfully
    /// indexed or skipped.
    #[inline]
    fn increment(&mut self) {
        self.current += 1;
    }

    /// Check if enough time has elapsed to emit the next progress event.
    ///
    /// Returns true if either:
    /// - We've reached the final session (always emit completion)
    /// - Sufficient time has passed since the last emission
    #[inline]
    fn should_emit(&self) -> bool {
        self.is_complete() || self.last_emit.elapsed() >= self.throttle
    }

    /// Check if we've reached the final session.
    #[inline]
    fn is_complete(&self) -> bool {
        self.current >= self.total
    }

    /// Emit progress if throttling allows, updating last_emit timestamp.
    ///
    /// Returns `true` if progress was emitted, `false` if throttled.
    fn emit_if_ready(
        &mut self,
        on_progress: &mut impl FnMut(&IndexingProgress),
        info: Option<SessionIndexInfo>,
    ) -> bool {
        if self.should_emit() {
            self.emit_internal(on_progress, info);
            true
        } else {
            false
        }
    }

    /// Force emit progress (for initial/final events), updating last_emit timestamp.
    ///
    /// Unlike `emit_if_ready`, this always emits regardless of throttling.
    fn emit(
        &mut self,
        on_progress: &mut impl FnMut(&IndexingProgress),
        info: Option<SessionIndexInfo>,
    ) {
        self.emit_internal(on_progress, info);
    }

    /// Internal helper to construct and emit progress, updating timestamp.
    #[inline]
    fn emit_internal(
        &mut self,
        on_progress: &mut impl FnMut(&IndexingProgress),
        info: Option<SessionIndexInfo>,
    ) {
        on_progress(&IndexingProgress {
            current: self.current,
            total: self.total,
            session_info: info,
            running_tokens: self.running_tokens,
            running_events: self.running_events,
            running_repos: self.seen_repos.len(),
        });
        self.last_emit = Instant::now();
    }
}

/// Default path for the TracePilot index database.
pub fn default_index_db_path() -> PathBuf {
    tracepilot_core::utils::home_dir()
        .join(".copilot")
        .join("tracepilot")
        .join("index.db")
}

/// Perform a full reindex of all sessions, pruning any that no longer exist on disk.
pub fn reindex_all(session_state_dir: &Path, index_db_path: &Path) -> Result<usize> {
    reindex_all_with_progress(session_state_dir, index_db_path, |_, _| {})
}

/// Full reindex with a simple progress callback invoked as `on_progress(current, total)`.
pub fn reindex_all_with_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<usize> {
    reindex_all_with_rich_progress(session_state_dir, index_db_path, |p| {
        on_progress(p.current, p.total);
    })
}

/// Full reindex with enriched progress callback including per-session data.
///
/// Uses Rayon to parse sessions in parallel (CPU/IO-bound), then writes
/// results to SQLite sequentially (rusqlite::Connection is !Send).
#[tracing::instrument(skip_all)]
pub fn reindex_all_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<usize> {
    let reindex_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let total = sessions.len();
    let mut tracker = ProgressTracker::new(total);

    // Emit initial progress so UI loading screen initializes immediately
    tracker.emit(&mut on_progress, None);

    // Phase 1: Parse all sessions in parallel (file I/O + JSON, no DB access)
    let prepared: Vec<_> = sessions
        .par_iter()
        .map(|session| {
            let result = index_db::session_writer::prepare_session_data(&session.path);
            (session.id.clone(), result)
        })
        .collect();

    // Phase 2: Write results to DB sequentially with throttled progress
    let mut indexed = 0;

    db.begin_transaction()?;
    for (session_id, parse_result) in prepared.into_iter() {
        let info = match parse_result {
            Ok(data) => match db.write_prepared_session(&data) {
                Ok(info) => {
                    indexed += 1;
                    tracker.accumulate(&info);
                    Some(info)
                }
                Err(e) => {
                    tracing::warn!(session_id = %session_id, error = %e, "Failed to write session");
                    None
                }
            },
            Err(e) => {
                tracing::warn!(session_id = %session_id, error = %e, "Failed to parse session");
                None
            }
        };

        tracker.increment();
        tracker.emit_if_ready(&mut on_progress, info);
    }
    db.commit_transaction()?;

    // Note: Final 100% emission is guaranteed by is_complete() check in emit_if_ready.
    // For zero sessions, the initial emit at line 206 covers it (current=0, total=0).

    tracing::debug!(
        indexed,
        total,
        elapsed_ms = reindex_start.elapsed().as_millis(),
        "Full reindex complete"
    );

    // Remove stale entries for sessions that no longer exist on disk
    match db.prune_deleted(&live_ids) {
        Ok(pruned) if pruned > 0 => {
            tracing::info!(pruned, "Pruned deleted sessions from index");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to prune deleted sessions");
        }
        _ => {}
    }

    Ok(indexed)
}

/// Reindex only sessions whose workspace.yaml/events.jsonl changed or analytics version bumped.
pub fn reindex_incremental(
    session_state_dir: &Path,
    index_db_path: &Path,
) -> Result<(usize, usize)> {
    reindex_incremental_with_progress(session_state_dir, index_db_path, |_, _| {})
}

/// Incremental reindex with a simple progress callback invoked as `on_progress(current, total)`.
pub fn reindex_incremental_with_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<(usize, usize)> {
    reindex_incremental_with_rich_progress(session_state_dir, index_db_path, |p| {
        on_progress(p.current, p.total);
    })
}

/// Incremental reindex with enriched progress callback including per-session data.
///
/// Emits progress for every session (including skipped ones) so the loading
/// screen tracks smoothly. Stale sessions are parsed in parallel via Rayon,
/// then written sequentially.
#[tracing::instrument(skip_all)]
pub fn reindex_incremental_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    let phase1_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let total = sessions.len();
    let mut tracker = ProgressTracker::new(total);

    // Step 1: Check staleness (sequential DB reads), emit throttled progress for skipped
    let mut stale_sessions = Vec::new();
    let mut skipped = 0;
    for session in &sessions {
        if db.needs_reindex(&session.id, &session.path) {
            stale_sessions.push(session);
        } else {
            skipped += 1;
            tracker.increment();
            tracker.emit_if_ready(&mut on_progress, None);
        }
    }

    // If nothing needs reindex, emit a final progress event so the UI reaches 100%
    if stale_sessions.is_empty() && total > 0 {
        tracker.emit(&mut on_progress, None);
    }

    // Step 2: Parse stale sessions in parallel (no DB access)
    let prepared: Vec<_> = stale_sessions
        .par_iter()
        .map(|session| {
            let result = index_db::session_writer::prepare_session_data(&session.path);
            (session.id.clone(), result)
        })
        .collect();

    // Step 3: Write results sequentially with progress
    let mut indexed = 0;

    // Batch size for transaction grouping — amortizes WAL fsyncs while keeping
    // lock duration reasonable for concurrent readers.
    const BATCH_SIZE: usize = 100;
    let mut batch_count = 0;
    let mut in_transaction = false;

    for (session_id, parse_result) in prepared.into_iter() {
        let info = match parse_result {
            Ok(data) => {
                if !in_transaction {
                    db.begin_transaction()?;
                    in_transaction = true;
                    batch_count = 0;
                }

                match db.write_prepared_session(&data) {
                    Ok(info) => {
                        indexed += 1;
                        batch_count += 1;
                        tracker.accumulate(&info);

                        // Commit batch when reaching BATCH_SIZE
                        if batch_count >= BATCH_SIZE {
                            db.commit_transaction()?;
                            in_transaction = false;
                        }

                        Some(info)
                    }
                    Err(e) => {
                        tracing::warn!(session_id = %session_id, error = %e, "Failed to write session");
                        None
                    }
                }
            }
            Err(e) => {
                tracing::warn!(session_id = %session_id, error = %e, "Failed to parse session");
                None
            }
        };

        tracker.increment();
        tracker.emit_if_ready(&mut on_progress, info);
    }

    // Commit any remaining batch
    if in_transaction {
        db.commit_transaction()?;
    }

    tracing::debug!(
        indexed,
        skipped,
        total,
        elapsed_ms = phase1_start.elapsed().as_millis(),
        "Incremental reindex complete"
    );

    // Prune sessions that no longer exist on disk
    match db.prune_deleted(&live_ids) {
        Ok(pruned) if pruned > 0 => {
            tracing::info!(pruned, "Pruned deleted sessions from index");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to prune deleted sessions");
        }
        _ => {}
    }

    Ok((indexed, skipped))
}

/// Progress info for search content indexing (Phase 2).
#[derive(Debug, Clone)]
pub struct SearchIndexingProgress {
    pub current: usize,
    pub total: usize,
}

/// Index search content for sessions that need it (Phase 2 — background).
///
/// This should be called AFTER Phase 1 (main reindex) completes.
/// Collects sessions needing reindex, parses events in parallel with Rayon,
/// then writes search content sequentially.
/// Returns (indexed_count, skipped_count).
#[tracing::instrument(skip_all)]
pub fn reindex_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let phase2_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    tracing::debug!(sessions = sessions.len(), "Phase 2: starting search content indexing");

    let total = sessions.len();

    // Step 1: Collect sessions needing search reindex (sequential DB reads)
    let mut to_index = Vec::new();
    let mut skipped = 0;

    for session in &sessions {
        if is_cancelled() {
            tracing::info!(skipped, "Search indexing cancelled during staleness check");
            return Ok((0, skipped));
        }
        if db.needs_search_reindex(&session.id, &session.path) {
            to_index.push(session);
        } else {
            skipped += 1;
        }
    }

    tracing::debug!(
        to_index = to_index.len(),
        skipped,
        total,
        "Search reindex: staleness check complete"
    );

    if to_index.is_empty() {
        on_progress(&SearchIndexingProgress { current: total, total });
        return Ok((0, skipped));
    }

    // Step 2: Parse events + extract search content in parallel (no DB access)
    let prepared: Vec<_> = to_index
        .par_iter()
        .map(|session| {
            let events_path = session.path.join("events.jsonl");
            let content = if events_path.exists() {
                match tracepilot_core::parsing::events::parse_typed_events(&events_path) {
                    Ok(parsed) => {
                        Some(index_db::search_writer::extract_search_content(
                            &session.id,
                            &parsed.events,
                        ))
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session.id,
                            error = %e,
                            "Failed to parse events for search indexing — skipping"
                        );
                        None
                    }
                }
            } else {
                Some(Vec::new())
            };
            (session.id.clone(), content)
        })
        .collect();

    // Check cancellation after parallel phase
    if is_cancelled() {
        tracing::info!("Search indexing cancelled after parse phase");
        return Ok((0, skipped));
    }

    // Step 3: Write search content to DB.
    // Use bulk write (drop triggers → insert → FTS rebuild) when many sessions
    // need indexing — ~5x faster than per-row trigger updates. Fall back to
    // per-session upsert for small incremental updates where the FTS rebuild
    // cost would outweigh the trigger savings.
    const BULK_THRESHOLD: usize = 10;
    let mut indexed = 0;
    let prepared_count = prepared.len();

    if prepared_count >= BULK_THRESHOLD {
        // Bulk path: collect all valid rows, write without triggers, rebuild FTS
        let bulk_data: Vec<(String, Vec<index_db::search_writer::SearchContentRow>)> = prepared
            .into_iter()
            .filter_map(|(id, content)| content.map(|rows| (id, rows)))
            .collect();

        if is_cancelled() {
            tracing::info!(indexed, skipped, "Search indexing cancelled before bulk write");
            return Ok((indexed, skipped));
        }

        let bulk_count = bulk_data.len();
        match db.bulk_write_search_content(&bulk_data) {
            Ok(rows) => {
                indexed = bulk_count;
                tracing::debug!(
                    sessions = bulk_count,
                    rows,
                    "Phase 2: bulk write complete"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "Phase 2: bulk write failed, falling back to per-session");
                // Fall back to per-session writes
                for (session_id, rows) in &bulk_data {
                    if is_cancelled() {
                        tracing::info!(indexed, skipped, "Search indexing cancelled during fallback write");
                        return Ok((indexed, skipped));
                    }
                    match db.upsert_search_content(session_id, rows) {
                        Ok(_) => indexed += 1,
                        Err(e) => {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %e,
                                "Failed to write search content"
                            );
                        }
                    }
                }
            }
        }
        on_progress(&SearchIndexingProgress { current: total, total });
    } else {
        // Incremental path: per-session upsert (triggers update FTS per row)
        for (i, (session_id, content)) in prepared.into_iter().enumerate() {
            if is_cancelled() {
                tracing::info!(indexed, skipped, "Search indexing cancelled during write");
                return Ok((indexed, skipped));
            }

            if let Some(ref rows) = content {
                let session_start = std::time::Instant::now();
                match db.upsert_search_content(&session_id, rows) {
                    Ok(_) => {
                        indexed += 1;
                        let elapsed = session_start.elapsed();
                        if elapsed.as_millis() > 100 {
                            tracing::debug!(
                                session_id = %session_id,
                                rows = rows.len(),
                                elapsed_ms = elapsed.as_millis(),
                                "Phase 2: slow session write"
                            );
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to write search content"
                        );
                    }
                }
            }

            // Throttle progress events (every 5 sessions or at end)
            let progress_idx = skipped + i + 1;
            if (i + 1) % 5 == 0 || i + 1 == prepared_count || progress_idx == total {
                on_progress(&SearchIndexingProgress {
                    current: progress_idx,
                    total,
                });
            }
        }
    }

    // Let SQLite optimize statistics if it deems necessary
    let _ = db.conn.execute_batch("PRAGMA optimize");

    tracing::debug!(
        indexed,
        skipped,
        total,
        elapsed_ms = phase2_start.elapsed().as_millis(),
        "Phase 2 complete"
    );

    Ok((indexed, skipped))
}

/// Full rebuild of search content: clears everything and re-indexes all sessions.
#[tracing::instrument(skip_all)]
pub fn rebuild_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    db.clear_search_content()?;
    let _ = db.conn.execute_batch("VACUUM;");
    drop(db);

    reindex_search_content(session_state_dir, index_db_path, on_progress, is_cancelled)
}

#[cfg(test)]
mod progress_tracker_tests {
    use super::*;

    #[test]
    fn new_tracker_starts_at_zero() {
        let tracker = ProgressTracker::new(10);
        assert_eq!(tracker.current, 0);
        assert_eq!(tracker.total, 10);
        assert_eq!(tracker.running_tokens, 0);
        assert_eq!(tracker.running_events, 0);
        assert_eq!(tracker.seen_repos.len(), 0);
    }

    #[test]
    fn accumulate_updates_metrics() {
        let mut tracker = ProgressTracker::new(10);
        let info = SessionIndexInfo {
            repository: Some("test/repo".into()),
            branch: None,
            current_model: None,
            total_tokens: 1000,
            event_count: 50,
            turn_count: 10,
        };
        tracker.accumulate(&info);
        assert_eq!(tracker.running_tokens, 1000);
        assert_eq!(tracker.running_events, 50);
        assert_eq!(tracker.seen_repos.len(), 1);
        assert!(tracker.seen_repos.contains("test/repo"));
    }

    #[test]
    fn accumulate_deduplicates_repos() {
        let mut tracker = ProgressTracker::new(10);
        let info = SessionIndexInfo {
            repository: Some("test/repo".into()),
            branch: None,
            current_model: None,
            total_tokens: 100,
            event_count: 10,
            turn_count: 5,
        };
        tracker.accumulate(&info);
        tracker.accumulate(&info); // Same repo
        assert_eq!(tracker.seen_repos.len(), 1); // Still 1
        assert_eq!(tracker.running_tokens, 200); // But tokens accumulate
        assert_eq!(tracker.running_events, 20); // And events accumulate
    }

    #[test]
    fn accumulate_handles_none_repository() {
        let mut tracker = ProgressTracker::new(10);
        let info = SessionIndexInfo {
            repository: None,
            branch: None,
            current_model: None,
            total_tokens: 100,
            event_count: 10,
            turn_count: 5,
        };
        tracker.accumulate(&info);
        assert_eq!(tracker.seen_repos.len(), 0);
        assert_eq!(tracker.running_tokens, 100);
        assert_eq!(tracker.running_events, 10);
    }

    #[test]
    fn increment_advances_current() {
        let mut tracker = ProgressTracker::new(10);
        assert_eq!(tracker.current, 0);
        tracker.increment();
        assert_eq!(tracker.current, 1);
        tracker.increment();
        assert_eq!(tracker.current, 2);
    }

    #[test]
    fn should_emit_when_complete() {
        let mut tracker = ProgressTracker::new(1);
        tracker.increment();
        assert!(tracker.should_emit()); // current == total
    }

    #[test]
    fn should_emit_respects_throttle_initially() {
        let mut tracker = ProgressTracker::new(100);
        tracker.increment();
        // Just started, not enough time elapsed
        assert!(!tracker.should_emit());
    }

    #[test]
    fn should_emit_after_throttle_duration() {
        let mut tracker = ProgressTracker::new(100);
        tracker.throttle = Duration::from_millis(10);
        tracker.increment();
        std::thread::sleep(Duration::from_millis(15));
        assert!(tracker.should_emit());
    }

    #[test]
    fn is_complete_checks_current_vs_total() {
        let mut tracker = ProgressTracker::new(5);
        assert!(!tracker.is_complete());
        tracker.current = 4;
        assert!(!tracker.is_complete());
        tracker.current = 5;
        assert!(tracker.is_complete());
        tracker.current = 6; // Even if over
        assert!(tracker.is_complete());
    }

    #[test]
    fn emit_updates_last_emit_timestamp() {
        let mut tracker = ProgressTracker::new(10);
        let start = tracker.last_emit;
        std::thread::sleep(Duration::from_millis(5));

        let mut called = false;
        tracker.emit(&mut |_| { called = true; }, None);

        assert!(called);
        assert!(tracker.last_emit > start);
    }

    #[test]
    fn emit_if_ready_respects_throttle() {
        let mut tracker = ProgressTracker::new(100);
        tracker.throttle = Duration::from_secs(10);
        tracker.increment();

        let mut call_count = 0;
        let emitted = tracker.emit_if_ready(&mut |_| { call_count += 1; }, None);

        assert!(!emitted);
        assert_eq!(call_count, 0);
    }

    #[test]
    fn emit_if_ready_emits_when_complete() {
        let mut tracker = ProgressTracker::new(2);
        tracker.increment();
        tracker.increment();

        let mut call_count = 0;
        let emitted = tracker.emit_if_ready(&mut |_| { call_count += 1; }, None);

        assert!(emitted);
        assert_eq!(call_count, 1);
    }

    #[test]
    fn emit_if_ready_emits_after_throttle_elapsed() {
        let mut tracker = ProgressTracker::new(100);
        tracker.throttle = Duration::from_millis(10);
        tracker.increment();

        std::thread::sleep(Duration::from_millis(15));

        let mut call_count = 0;
        let emitted = tracker.emit_if_ready(&mut |_| { call_count += 1; }, None);

        assert!(emitted);
        assert_eq!(call_count, 1);
    }

    #[test]
    fn progress_data_correct() {
        let mut tracker = ProgressTracker::new(10);
        tracker.increment();
        tracker.running_tokens = 5000;
        tracker.running_events = 100;
        tracker.seen_repos.insert("repo1".into());
        tracker.seen_repos.insert("repo2".into());

        let mut received_progress = None;
        tracker.emit(&mut |progress| {
            received_progress = Some(progress.clone());
        }, None);

        let progress = received_progress.unwrap();
        assert_eq!(progress.current, 1);
        assert_eq!(progress.total, 10);
        assert_eq!(progress.running_tokens, 5000);
        assert_eq!(progress.running_events, 100);
        assert_eq!(progress.running_repos, 2);
        assert!(progress.session_info.is_none());
    }

    #[test]
    fn progress_includes_session_info_when_provided() {
        let mut tracker = ProgressTracker::new(10);
        tracker.increment();

        let info = SessionIndexInfo {
            repository: Some("test/repo".into()),
            branch: Some("main".into()),
            current_model: Some("claude-sonnet-4".into()),
            total_tokens: 500,
            event_count: 25,
            turn_count: 8,
        };

        let mut received_progress = None;
        tracker.emit(&mut |progress| {
            received_progress = Some(progress.clone());
        }, Some(info.clone()));

        let progress = received_progress.unwrap();
        assert!(progress.session_info.is_some());
        let session_info = progress.session_info.unwrap();
        assert_eq!(session_info.total_tokens, 500);
        assert_eq!(session_info.event_count, 25);
        assert_eq!(session_info.repository, Some("test/repo".into()));
    }

    #[test]
    fn zero_sessions_doesnt_panic() {
        let mut tracker = ProgressTracker::new(0);
        tracker.emit(&mut |_| {}, None);
        assert!(tracker.is_complete());
        assert_eq!(tracker.current, 0);
        assert_eq!(tracker.total, 0);
    }

    #[test]
    fn single_session_workflow() {
        let mut tracker = ProgressTracker::new(1);
        let mut emissions = Vec::new();

        // Initial emit
        tracker.emit(&mut |p| emissions.push(p.current), None);
        assert_eq!(emissions.len(), 1);
        assert_eq!(emissions[0], 0);

        // Process session
        tracker.increment();
        tracker.emit_if_ready(&mut |p| emissions.push(p.current), None);

        // Should have emitted because current == total
        assert_eq!(emissions.len(), 2);
        assert_eq!(emissions[1], 1);
    }

    #[test]
    fn multiple_emissions_track_progress() {
        let mut tracker = ProgressTracker::new(5);
        tracker.throttle = Duration::from_millis(1); // Very short for testing

        let mut emissions = Vec::new();

        for _ in 0..5 {
            tracker.increment();
            std::thread::sleep(Duration::from_millis(2)); // Ensure throttle passes
            tracker.emit_if_ready(&mut |p| emissions.push(p.current), None);
        }

        // Should have emitted all 5 because throttle is short
        assert_eq!(emissions.len(), 5);
        assert_eq!(emissions, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn throttling_reduces_emission_count() {
        let mut tracker = ProgressTracker::new(100);
        tracker.throttle = Duration::from_secs(10); // Very long

        let mut emissions = 0;

        for _ in 0..99 {
            tracker.increment();
            if tracker.emit_if_ready(&mut |_| emissions += 1, None) {
                // Progress emitted
            }
        }

        // Should not have emitted for any of the first 99 (throttle not elapsed)
        assert_eq!(emissions, 0);

        // But the 100th should emit (complete)
        tracker.increment();
        tracker.emit_if_ready(&mut |_| emissions += 1, None);
        assert_eq!(emissions, 1);
    }
}
