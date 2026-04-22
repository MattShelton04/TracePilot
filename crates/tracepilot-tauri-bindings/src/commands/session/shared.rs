//! Internal helpers shared across the session command submodules.

use std::path::Path;
use std::sync::Arc;
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

    let events =
        Arc::new(tracepilot_core::parsing::events::parse_typed_events(events_path)?.events);

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
