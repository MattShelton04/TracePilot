//! Progress tracking and emission types for indexing operations.

use std::time::{Duration, Instant};

use crate::index_db::SessionIndexInfo;

/// Minimum interval between progress events to avoid flooding IPC.
pub(crate) const PROGRESS_THROTTLE: Duration = Duration::from_millis(80);

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

/// Progress info for search content indexing (Phase 2).
#[derive(Debug, Clone)]
pub struct SearchIndexingProgress {
    pub current: usize,
    pub total: usize,
}

/// Tracks and emits throttled progress during indexing operations.
///
/// Accumulates running totals (tokens, events, repos) and emits progress
/// events at a controlled rate to avoid flooding IPC channels.
///
/// # Thread Safety
///
/// All fields are `Send`, but this type is intended for single-threaded use
/// after parallel parsing completes via Rayon. Do not share across threads.
///
/// # Progress Semantics
///
/// The `current` counter represents sessions that have been **fully processed**
/// (indexed or skipped). During incremental reindex staleness checks, sessions
/// identified for reindexing are NOT included in `current` until they are
/// actually indexed.
pub(crate) struct ProgressTracker {
    pub(crate) current: usize,
    pub(crate) total: usize,
    pub(crate) running_tokens: u64,
    pub(crate) running_events: u64,
    pub(crate) seen_repos: std::collections::HashSet<String>,
    pub(crate) last_emit: Instant,
    pub(crate) throttle: Duration,
}

impl ProgressTracker {
    /// Create a new tracker for indexing `total` sessions.
    pub(crate) fn new(total: usize) -> Self {
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
    pub(crate) fn accumulate(&mut self, info: &SessionIndexInfo) {
        self.running_tokens += info.total_tokens;
        self.running_events += info.event_count as u64;
        if let Some(repo) = &info.repository {
            // Use get_or_insert pattern to avoid cloning if repo already seen
            if !self.seen_repos.contains(repo.as_str()) {
                self.seen_repos.insert(repo.clone());
            }
        }
    }

    /// Increment the current session counter.
    ///
    /// This should be called for every session processed, whether successfully
    /// indexed or skipped.
    pub(crate) fn increment(&mut self) {
        self.current += 1;
    }

    /// Check if enough time has elapsed to emit the next progress event.
    ///
    /// Returns true if either:
    /// - We've reached the final session (always emit completion)
    /// - Sufficient time has passed since the last emission
    pub(crate) fn should_emit(&self) -> bool {
        self.is_complete() || self.last_emit.elapsed() >= self.throttle
    }

    /// Check if we've reached the final session.
    pub(crate) fn is_complete(&self) -> bool {
        self.current >= self.total
    }

    /// Emit progress if throttling allows, updating last_emit timestamp.
    ///
    /// Returns `true` if progress was emitted, `false` if throttled.
    pub(crate) fn emit_if_ready(
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
    pub(crate) fn emit(
        &mut self,
        on_progress: &mut impl FnMut(&IndexingProgress),
        info: Option<SessionIndexInfo>,
    ) {
        self.emit_internal(on_progress, info);
    }

    /// Internal helper to construct and emit progress, updating timestamp.
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

#[cfg(test)]
mod tests;
