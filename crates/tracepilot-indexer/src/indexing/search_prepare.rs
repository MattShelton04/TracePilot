//! Bounded parallel search preparation with cancellation owned by the caller.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use tracepilot_core::ids::SessionId;
use tracepilot_core::parsing::snapshot::{FileFingerprint, check_cancelled, ensure_unchanged};
use tracepilot_core::session::discovery::DiscoveredSession;

use crate::Result;
use crate::index_db::search_writer::{SearchContentRow, extract_search_content_cancellable};

pub(super) struct PreparedSearch {
    pub session_id: SessionId,
    pub rows: Vec<SearchContentRow>,
    pub fingerprint: String,
}

/// The existing callback may be !Sync (for example UI-owned state). Poll it on
/// the calling thread and share only an atomic signal with Rayon workers. The
/// scope joins every worker before returning, including on cancellation.
pub(super) fn prepare_batch(
    batch: &[&DiscoveredSession],
    is_cancelled: &impl Fn() -> bool,
) -> Vec<PreparedSearch> {
    // A caller already running on the sole Rayon worker cannot block while
    // waiting for jobs queued to that worker. Keep nested indexing synchronous.
    if rayon::current_thread_index().is_some() {
        return batch
            .iter()
            .filter_map(|session| match prepare_search(session, is_cancelled) {
                Ok(snapshot) => Some(snapshot),
                Err(error) => {
                    tracing::warn!(session_id = %session.id, error = %error,
                        "Search snapshot not indexed; retaining previous content");
                    None
                }
            })
            .collect();
    }
    let cancelled = AtomicBool::new(false);
    let mut prepared = Vec::new();
    rayon::in_place_scope(|scope| {
        let (sender, receiver) = mpsc::channel();
        for session in batch {
            let sender = sender.clone();
            let cancelled = &cancelled;
            scope.spawn(move |_| {
                let result = prepare_search(session, &|| cancelled.load(Ordering::Relaxed));
                // The receiver lives until all workers finish; a dropped receiver
                // means the caller is unwinding and no result can be published.
                let _ = sender.send((session.id.clone(), result));
            });
        }
        drop(sender);
        loop {
            if is_cancelled() {
                cancelled.store(true, Ordering::Relaxed);
            }
            match receiver.recv_timeout(Duration::from_millis(5)) {
                Ok((_, Ok(snapshot))) => prepared.push(snapshot),
                Ok((id, Err(error))) => tracing::warn!(session_id = %id, error = %error,
                    "Search snapshot not indexed; retaining previous content"),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    prepared
}

fn prepare_search(
    session: &DiscoveredSession,
    is_cancelled: &impl Fn() -> bool,
) -> Result<PreparedSearch> {
    let path = session.path.join("events.jsonl");
    let snapshot = tracepilot_core::parsing::events::load_event_snapshot(&path, is_cancelled)?;
    let rows = snapshot.parsed.map_or_else(
        || Some(Vec::new()),
        |parsed| extract_search_content_cancellable(&session.id, &parsed.events, is_cancelled),
    );
    check_cancelled(is_cancelled)?;
    ensure_unchanged(&snapshot.fingerprint, &FileFingerprint::read(&path)?, &path)?;
    Ok(PreparedSearch {
        session_id: session.id.clone(),
        rows: rows.unwrap_or_default(),
        fingerprint: serde_json::to_string(&snapshot.fingerprint)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preparation_completes_inside_a_single_worker_rayon_pool() {
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let temp = tempfile::tempdir().unwrap();
            std::fs::write(
                temp.path().join("events.jsonl"),
                "{\"type\":\"user.message\",\"data\":{\"content\":\"nested sentinel\"}}\n",
            )
            .unwrap();
            let session = DiscoveredSession {
                id: SessionId::from_validated("11111111-1111-4111-8111-111111111111"),
                path: temp.path().to_path_buf(),
                has_workspace_yaml: false,
                has_events_jsonl: true,
                has_session_db: false,
            };
            let pool = rayon::ThreadPoolBuilder::new()
                .num_threads(1)
                .build()
                .unwrap();
            let count = pool.install(|| prepare_batch(&[&session], &|| false).len());
            sender.send(count).unwrap();
        });
        assert_eq!(receiver.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
    }
}
