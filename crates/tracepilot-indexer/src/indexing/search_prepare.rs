//! Bounded parallel search preparation with cancellation owned by the caller.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use tracepilot_core::ids::SessionId;
use tracepilot_core::parsing::snapshot::{check_cancelled, ensure_unchanged};
use tracepilot_core::provider::{SessionLocator, SessionProvider};

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
///
/// Results keep the batch order, so rows are written in the same order
/// whichever worker finishes first.
pub(super) fn prepare_batch(
    provider: &Arc<dyn SessionProvider>,
    batch: &[&SessionLocator],
    is_cancelled: &impl Fn() -> bool,
) -> Vec<PreparedSearch> {
    // A caller already running on the sole Rayon worker cannot block while
    // waiting for jobs queued to that worker. Keep nested indexing synchronous.
    if rayon::current_thread_index().is_some() {
        return batch
            .iter()
            .filter_map(
                |session| match prepare_search(provider, session, is_cancelled) {
                    Ok(snapshot) => Some(snapshot),
                    Err(error) => {
                        tracing::warn!(session_id = %session.id, error = %error,
                        "Search snapshot not indexed; retaining previous content");
                        None
                    }
                },
            )
            .collect();
    }
    let cancelled = AtomicBool::new(false);
    let mut prepared = Vec::new();
    rayon::in_place_scope(|scope| {
        let (sender, receiver) = mpsc::channel();
        for (index, session) in batch.iter().enumerate() {
            let sender = sender.clone();
            let cancelled = &cancelled;
            scope.spawn(move |_| {
                let result =
                    prepare_search(provider, session, &|| cancelled.load(Ordering::Relaxed));
                // The receiver lives until all workers finish; a dropped receiver
                // means the caller is unwinding and no result can be published.
                let _ = sender.send((index, session.id.clone(), result));
            });
        }
        drop(sender);
        loop {
            if is_cancelled() {
                cancelled.store(true, Ordering::Relaxed);
            }
            match receiver.recv_timeout(Duration::from_millis(5)) {
                Ok((index, _, Ok(snapshot))) => prepared.push((index, snapshot)),
                Ok((_, id, Err(error))) => tracing::warn!(session_id = %id, error = %error,
                    "Search snapshot not indexed; retaining previous content"),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    prepared.sort_by_key(|(index, _)| *index);
    prepared.into_iter().map(|(_, snapshot)| snapshot).collect()
}

fn prepare_search(
    provider: &Arc<dyn SessionProvider>,
    session: &SessionLocator,
    is_cancelled: &impl Fn() -> bool,
) -> Result<PreparedSearch> {
    let loaded = provider.load_events_strict(session, is_cancelled)?;
    let rows = loaded.events.map_or_else(
        || Some(Vec::new()),
        |events| extract_search_content_cancellable(&session.id, &events, is_cancelled),
    );
    check_cancelled(is_cancelled)?;
    let fingerprint = provider.stored_search_fingerprint(&loaded.fingerprint)?;
    let current = provider.stored_search_fingerprint(&provider.fingerprint(session)?)?;
    ensure_unchanged(&fingerprint, &current, &session.primary_path)?;
    Ok(PreparedSearch {
        session_id: session.id.clone(),
        rows: rows.unwrap_or_default(),
        fingerprint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracepilot_core::provider::CopilotProvider;

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
            let session = CopilotProvider::session_at(temp.path());
            let provider: Arc<dyn SessionProvider> = Arc::new(CopilotProvider::new(temp.path()));
            let pool = rayon::ThreadPoolBuilder::new()
                .num_threads(1)
                .build()
                .unwrap();
            let count = pool.install(|| prepare_batch(&provider, &[&session], &|| false).len());
            sender.send(count).unwrap();
        });
        assert_eq!(receiver.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
    }
}
