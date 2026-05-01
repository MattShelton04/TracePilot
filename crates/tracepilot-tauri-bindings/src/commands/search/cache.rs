//! Facets TTL cache shared by search content and indexing commands.

use crate::cache::TtlCache;
use crate::types::SearchFacetsResponse;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::LazyLock;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Facets TTL cache (P1 perf fix)
// ---------------------------------------------------------------------------

pub(super) static FACETS_CACHE: LazyLock<TtlCache<u64, SearchFacetsResponse>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(60)));

// Cache-key helper: argument set mirrors the IPC command's filter surface and
// each value is independently hashed; grouping them in a struct would duplicate
// the same fields with no clarity win.
#[allow(clippy::too_many_arguments)]
pub(super) fn facets_cache_key(
    query: &Option<String>,
    content_types: &Option<Vec<String>>,
    exclude_content_types: &Option<Vec<String>>,
    repositories: &Option<Vec<String>>,
    tool_names: &Option<Vec<String>>,
    session_id: &Option<String>,
    date_from_unix: &Option<i64>,
    date_to_unix: &Option<i64>,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    query.hash(&mut hasher);
    content_types.hash(&mut hasher);
    exclude_content_types.hash(&mut hasher);
    repositories.hash(&mut hasher);
    tool_names.hash(&mut hasher);
    session_id.hash(&mut hasher);
    date_from_unix.hash(&mut hasher);
    date_to_unix.hash(&mut hasher);
    hasher.finish()
}

/// Clear the facets cache (called after reindex / rebuild operations).
pub fn invalidate_facets_cache() {
    FACETS_CACHE.clear();
}
