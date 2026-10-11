//! Read caches for the search index: facets, tool names and FTS health.
//!
//! Values hold until the index changes. Every index change (reindex, search
//! pass, purge, rebuild, optimize, reset or a moved index) calls
//! [`invalidate_index_read_caches`], and values are neither served nor stored
//! while an indexing job holds a gate, since a running pass commits in
//! batches and invalidates only when it ends.

use std::hash::Hash;
use std::path::PathBuf;
use std::sync::LazyLock;

use tracepilot_core::provider::SessionSource;
use tracepilot_indexer::SearchFilters;
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::index_db::SearchToolName;
use tracepilot_indexer::index_db::search_reader::FtsHealthInfo;

use crate::blocking_cmd;
use crate::cache::GenerationCache;
use crate::concurrency::IndexingSemaphores;
use crate::error::{BindingsError, CmdResult};
use crate::types::SearchFacetsResponse;

/// Facets for the whole index, fetched on every Search page load. Kept apart
/// from filtered facets so a burst of searches never evicts it.
pub(super) static UNFILTERED_FACETS_CACHE: LazyLock<IndexReadCache<(), SearchFacetsResponse>> =
    LazyLock::new(|| GenerationCache::new(1));

/// Facets per filter set (see [`facets_cache_key`]).
pub(super) static FACETS_CACHE: LazyLock<IndexReadCache<FacetsKey, SearchFacetsResponse>> =
    LazyLock::new(|| GenerationCache::new(32));

pub(super) static TOOL_NAMES_CACHE: LazyLock<IndexReadCache<(), Vec<SearchToolName>>> =
    LazyLock::new(|| GenerationCache::new(1));

pub(super) static FTS_HEALTH_CACHE: LazyLock<IndexReadCache<(), FtsHealthInfo>> =
    LazyLock::new(|| GenerationCache::new(1));

/// Values keyed by index path too, so a moved index never serves the old one.
pub(super) type IndexReadCache<K, V> = GenerationCache<(PathBuf, K), V>;

/// Key for one facets query: the query and the filters `facets` reads, held
/// by value so two filter sets never share an entry.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct FacetsKey {
    query: Option<String>,
    content_types: Vec<String>,
    exclude_content_types: Vec<String>,
    repositories: Vec<String>,
    tool_names: Vec<String>,
    session_id: Option<String>,
    source: Option<SessionSource>,
    date_from_unix: Option<i64>,
    date_to_unix: Option<i64>,
}

pub(super) fn facets_cache_key(query: &Option<String>, filters: &SearchFilters) -> FacetsKey {
    FacetsKey {
        query: query.clone(),
        content_types: filters.content_types.clone(),
        exclude_content_types: filters.exclude_content_types.clone(),
        repositories: filters.repositories.clone(),
        tool_names: filters.tool_names.clone(),
        session_id: filters.session_id.clone(),
        source: filters.source,
        date_from_unix: filters.date_from_unix,
        date_to_unix: filters.date_to_unix,
    }
}

/// Whether a facets query covers the whole index.
pub(super) fn is_unfiltered(query: &Option<String>, filters: &SearchFilters) -> bool {
    query.is_none()
        && filters.content_types.is_empty()
        && filters.exclude_content_types.is_empty()
        && filters.repositories.is_empty()
        && filters.tool_names.is_empty()
        && filters.session_id.is_none()
        && filters.source.is_none()
        && filters.date_from_unix.is_none()
        && filters.date_to_unix.is_none()
}

/// Whether no indexing job holds a gate, so the index is not mid-write.
fn index_idle(gates: &IndexingSemaphores) -> bool {
    gates.sessions_available() > 0 && gates.search_available() > 0
}

/// `read` against the index at `index_path`, reused until the index changes.
pub(super) async fn cached_index_read<K, V, F>(
    cache: &IndexReadCache<K, V>,
    gates: &IndexingSemaphores,
    index_path: PathBuf,
    key: K,
    read: F,
) -> CmdResult<V>
where
    K: Hash + Eq,
    V: Clone + Send + 'static,
    F: FnOnce(&IndexDb) -> tracepilot_indexer::Result<V> + Send + 'static,
{
    let generation = cache.generation();
    let idle = index_idle(gates);
    let key = (index_path, key);
    if idle && let Some(value) = cache.get(&key) {
        return Ok(value);
    }
    let path = key.0.clone();
    let value: CmdResult<V> = blocking_cmd!({
        let db = IndexDb::open_readonly(&path)?;
        Ok::<V, BindingsError>(read(&db)?)
    });
    let value = value?;
    // A job that started meanwhile may have changed what was read; one that
    // also finished has moved the generation on, so the insert is dropped.
    if idle && index_idle(gates) {
        cache.insert(generation, key, value.clone());
    }
    Ok(value)
}

/// Drop every cached search-index read. Called after anything that changes
/// the index, before views are told to refetch.
pub fn invalidate_index_read_caches() {
    UNFILTERED_FACETS_CACHE.invalidate();
    FACETS_CACHE.invalidate();
    TOOL_NAMES_CACHE.invalidate();
    FTS_HEALTH_CACHE.invalidate();
}

/// How often the read caches have been invalidated, for other modules' tests.
#[cfg(test)]
pub(crate) fn index_read_cache_invalidations() -> u64 {
    TOOL_NAMES_CACHE.generation()
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;
