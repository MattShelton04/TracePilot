//! Search preparation for one session; [`pipeline`](super::pipeline) runs it
//! on Rayon workers.

use std::sync::Arc;

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

/// Load one session's events and extract its search rows, failing if the
/// source changed while it was read.
pub(super) fn prepare_search(
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
