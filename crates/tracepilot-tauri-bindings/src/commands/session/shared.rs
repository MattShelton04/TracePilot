//! Internal helpers shared across the session command submodules.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tracepilot_core::parsing::events::TypedEvent;
use tracepilot_core::paths::SessionPaths;
use tracepilot_core::provider::{ResolvedSession, SessionSource};

use crate::error::BindingsError;
use crate::types::{CachedEvents, EventCache, SourceStamp};

pub(super) fn system_time_to_unix_millis(time: Option<SystemTime>) -> Option<i64> {
    time.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

/// The session's current source state, read before loading. Blocking.
///
/// When the provider cannot fingerprint the session (for example, a stat
/// error on a side file), the stamp falls back to the event log alone, as
/// the freshness checks did before fingerprints, instead of failing.
pub(super) fn source_stamp(session: &ResolvedSession) -> Result<SourceStamp, BindingsError> {
    let fingerprint = match session.provider.fingerprint(&session.locator) {
        Ok(fingerprint) => fingerprint,
        Err(error) => {
            tracing::warn!(%error, "Session fingerprint failed; stamping from the event log");
            return Ok(event_log_stamp(session));
        }
    };
    let present = fingerprint
        .files
        .iter()
        .filter_map(|(path, file)| Some((path, file.as_ref()?)));
    let (events_file_size, events_file_mtime) = if session.locator.source == SessionSource::Copilot
    {
        // Copilot's legacy fields describe `events.jsonl` alone, as before.
        let events = SessionPaths::from_root(&session.locator.primary_path).events_jsonl();
        present
            .filter(|(path, _)| **path == events)
            .map(|(_, file)| (file.size, Some(file.modified)))
            .next()
            .unwrap_or((0, None))
    } else {
        present.fold((0, None), |(size, latest), (_, file)| {
            (size + file.size, latest.max(Some(file.modified)))
        })
    };
    Ok(SourceStamp {
        version: fingerprint.source_version(),
        events_file_size,
        events_file_mtime,
    })
}

/// A stamp from the event log's metadata only. Its version never equals a
/// fingerprint's `source_version`, so switching between the two misses the
/// cache once rather than serving stale entries.
fn event_log_stamp(session: &ResolvedSession) -> SourceStamp {
    let path = if session.locator.source == SessionSource::Copilot {
        SessionPaths::from_root(&session.locator.primary_path).events_jsonl()
    } else {
        session.locator.primary_path.clone()
    };
    let metadata = std::fs::metadata(path).ok();
    let size = metadata.as_ref().map_or(0, |m| m.len());
    let modified = metadata.and_then(|m| m.modified().ok());
    let nanos = modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos());
    SourceStamp {
        version: format!("stat:{size}:{nanos:?}"),
        events_file_size: size,
        events_file_mtime: modified,
    }
}

/// The session's events, from the cache while its `source_version` is
/// unchanged. Blocking.
pub(super) fn load_cached_typed_events(
    cache: &EventCache,
    session: &ResolvedSession,
) -> Result<(Arc<Vec<TypedEvent>>, SourceStamp), BindingsError> {
    let session_id = session.locator.id.as_str();
    let stamp = source_stamp(session)?;
    let cached_events = match cache.lock() {
        Ok(mut lru) => lru
            .get(session_id)
            .filter(|cached| cached.stamp.version == stamp.version)
            .map(|cached| Arc::clone(&cached.events)),
        Err(_) => {
            tracing::warn!("Event cache Mutex poisoned — skipping cache read");
            None
        }
    };

    if let Some(events) = cached_events {
        return Ok((events, stamp));
    }

    // Single-flight per session: concurrent misses (prefetch racing the
    // foreground open, detail racing turns) wait for one parse and then hit
    // the cache, instead of each parsing the same event log.
    let parse_lock = session_parse_lock(session_id);
    let _parsing = parse_lock.lock().unwrap_or_else(|p| p.into_inner());
    if let Ok(mut lru) = cache.lock()
        && let Some(cached) = lru
            .get(session_id)
            .filter(|cached| cached.stamp.version == stamp.version)
    {
        return Ok((Arc::clone(&cached.events), stamp));
    }

    // Some sessions exist in the index but have no event log yet — e.g. a
    // freshly-created session, or one whose log was cleaned up. Providers
    // return `Ok(None)` for that case so best-effort callers (prefetch,
    // shutdown metrics) don't surface noise as "Failed to open" errors.
    let events = Arc::new(
        session
            .provider
            .load_events(&session.locator, &|| false)?
            .unwrap_or_default(),
    );

    if let Ok(mut lru) = cache.lock() {
        lru.put(
            session_id.to_string(),
            CachedEvents {
                events: Arc::clone(&events),
                stamp: stamp.clone(),
            },
        );
    } else {
        tracing::warn!("Event cache Mutex poisoned — skipping cache write");
    }

    Ok((events, stamp))
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
