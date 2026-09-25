//! Internal helpers shared across the session command submodules.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::BindingsError;
use crate::types::{CachedEvents, EventCache};

pub(super) fn system_time_to_unix_millis(time: Option<SystemTime>) -> Option<i64> {
    time.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

// Tuple return is ad-hoc and deliberately local to this helper; factoring it
// into a `type` alias would obscure the call site without reducing churn.
#[allow(clippy::type_complexity)]
pub(super) fn load_cached_typed_events(
    cache: &EventCache,
    session_id: &str,
    events_path: &Path,
) -> Result<
    (
        Arc<Vec<tracepilot_core::parsing::events::TypedEvent>>,
        u64,
        Option<std::time::SystemTime>,
    ),
    BindingsError,
> {
    let meta = std::fs::metadata(events_path).ok();
    let file_size = meta.as_ref().map_or(0, |m| m.len());
    let file_mtime = meta.and_then(|m| m.modified().ok());

    let cached_events = match cache.lock() {
        Ok(mut lru) => lru
            .get(session_id)
            .filter(|cached| {
                cached.events_file_size == file_size && cached.events_file_mtime == file_mtime
            })
            .map(|cached| Arc::clone(&cached.events)),
        Err(_) => {
            tracing::warn!("Event cache Mutex poisoned — skipping cache read");
            None
        }
    };

    if let Some(events) = cached_events {
        return Ok((events, file_size, file_mtime));
    }

    // Single-flight per session: concurrent misses (prefetch racing the
    // foreground open, detail racing turns) wait for one parse and then hit
    // the cache, instead of each parsing the same event log.
    let parse_lock = session_parse_lock(session_id);
    let _parsing = parse_lock.lock().unwrap_or_else(|p| p.into_inner());
    if let Ok(mut lru) = cache.lock()
        && let Some(cached) = lru.get(session_id).filter(|cached| {
            cached.events_file_size == file_size && cached.events_file_mtime == file_mtime
        })
    {
        return Ok((Arc::clone(&cached.events), file_size, file_mtime));
    }

    // Some sessions exist in the index (and on disk as a directory) but have
    // no events.jsonl yet — e.g. a freshly-created session, or a session whose
    // event log was cleaned up. `parse_typed_events_if_exists` returns
    // `Ok(None)` for that case so best-effort callers (prefetch, shutdown
    // metrics) don't surface noise as "Failed to open" errors.
    let events = Arc::new(
        tracepilot_core::parsing::events::parse_typed_events_if_exists(events_path)?
            .map(|p| p.events)
            .unwrap_or_default(),
    );

    if let Ok(mut lru) = cache.lock() {
        lru.put(
            session_id.to_string(),
            CachedEvents {
                events: Arc::clone(&events),
                events_file_size: file_size,
                events_file_mtime: file_mtime,
            },
        );
    } else {
        tracing::warn!("Event cache Mutex poisoned — skipping cache write");
    }

    Ok((events, file_size, file_mtime))
}

/// Per-session parse locks. Entries are removed once no caller holds them,
/// so the map only contains sessions that are being parsed right now.
static PARSE_LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct SessionParseLock {
    session_id: String,
    lock: Arc<Mutex<()>>,
}

impl std::ops::Deref for SessionParseLock {
    type Target = Mutex<()>;
    fn deref(&self) -> &Mutex<()> {
        &self.lock
    }
}

impl Drop for SessionParseLock {
    fn drop(&mut self) {
        let mut locks = PARSE_LOCKS.lock().unwrap_or_else(|p| p.into_inner());
        // Two references remain when this is the last user: ours and the map's.
        if Arc::strong_count(&self.lock) <= 2 {
            locks.remove(&self.session_id);
        }
    }
}

fn session_parse_lock(session_id: &str) -> SessionParseLock {
    let mut locks = PARSE_LOCKS.lock().unwrap_or_else(|p| p.into_inner());
    let lock = Arc::clone(locks.entry(session_id.to_string()).or_default());
    SessionParseLock {
        session_id: session_id.to_string(),
        lock,
    }
}

#[cfg(test)]
mod parse_lock_tests {
    use super::*;

    #[test]
    fn parse_lock_is_shared_while_held_and_released_after() {
        let a = session_parse_lock("s-parse-lock-test");
        let b = session_parse_lock("s-parse-lock-test");
        assert!(Arc::ptr_eq(&a.lock, &b.lock));
        drop(a);
        assert!(
            PARSE_LOCKS
                .lock()
                .unwrap()
                .contains_key("s-parse-lock-test")
        );
        drop(b);
        assert!(
            !PARSE_LOCKS
                .lock()
                .unwrap()
                .contains_key("s-parse-lock-test")
        );
    }
}
