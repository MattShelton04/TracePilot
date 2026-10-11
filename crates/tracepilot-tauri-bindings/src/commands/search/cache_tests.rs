//! Search-index read caches: reuse, invalidation, and gated jobs.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use tracepilot_indexer::index_db::IndexDb;

use super::*;

/// An empty index database in a temporary directory.
fn index() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index.db");
    IndexDb::open_or_create(&path).unwrap();
    (dir, path)
}

/// What an indexing pass would write: one session with one tool row.
fn index_tool_row(path: &Path, session: &str, tool: &str) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO sessions (id, path, source) VALUES (?1, ?1, 'copilot')",
        [session],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO search_content (session_id, content_type, tool_name, content) \
         VALUES (?1, 'tool_call', ?2, 'ls')",
        [session, tool],
    )
    .unwrap();
}

/// Reads through `cache`, counting the reads that reached the database.
async fn counted_read(
    cache: &IndexReadCache<(), usize>,
    gates: &IndexingSemaphores,
    path: &Path,
    reads: &Arc<AtomicUsize>,
) -> usize {
    let reads = Arc::clone(reads);
    cached_index_read(cache, gates, path.to_path_buf(), (), move |db| {
        reads.fetch_add(1, Ordering::SeqCst);
        db.search_content_row_count()
    })
    .await
    .unwrap()
}

async fn tool_names(
    cache: &IndexReadCache<(), Vec<String>>,
    gates: &IndexingSemaphores,
    path: &Path,
) -> Vec<String> {
    cached_index_read(cache, gates, path.to_path_buf(), (), |db| {
        Ok(db
            .search_tool_names()?
            .into_iter()
            .map(|tool| tool.name)
            .collect())
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn a_read_is_reused_until_the_index_changes() {
    let (_dir, path) = index();
    let (cache, gates) = (GenerationCache::new(1), IndexingSemaphores::new());
    index_tool_row(&path, "s1", "view");
    assert_eq!(tool_names(&cache, &gates, &path).await, ["view"]);

    // Indexed without the hook: still the cached answer.
    index_tool_row(&path, "s2", "edit");
    assert_eq!(tool_names(&cache, &gates, &path).await, ["view"]);

    cache.invalidate();
    assert_eq!(tool_names(&cache, &gates, &path).await, ["edit", "view"]);
}

#[tokio::test]
async fn the_shared_hook_invalidates_every_search_read_cache() {
    let (_dir, path) = index();
    let gates = IndexingSemaphores::new();
    let key = || (path.clone(), ());
    let generation = TOOL_NAMES_CACHE.generation();
    TOOL_NAMES_CACHE.insert(generation, key(), Vec::new());
    let generation = UNFILTERED_FACETS_CACHE.generation();
    UNFILTERED_FACETS_CACHE.insert(
        generation,
        key(),
        SearchFacetsResponse {
            by_content_type: Vec::new(),
            by_repository: Vec::new(),
            by_tool_name: Vec::new(),
            total_matches: 0,
            session_count: 0,
        },
    );
    cached_index_read(&FTS_HEALTH_CACHE, &gates, path.clone(), (), |db| {
        db.fts_health()
    })
    .await
    .unwrap();

    invalidate_index_read_caches();

    assert!(TOOL_NAMES_CACHE.get(&key()).is_none());
    assert!(UNFILTERED_FACETS_CACHE.get(&key()).is_none());
    assert!(FTS_HEALTH_CACHE.get(&key()).is_none());
}

#[tokio::test]
async fn a_read_that_races_an_index_change_is_not_kept() {
    let (_dir, path) = index();
    let cache = Arc::new(GenerationCache::new(1));
    let gates = IndexingSemaphores::new();
    let invalidating = Arc::clone(&cache);
    // The pass finishes (and invalidates) while this read is running.
    cached_index_read(&cache, &gates, path.clone(), (), move |db| {
        let rows = db.search_content_row_count();
        invalidating.invalidate();
        rows
    })
    .await
    .unwrap();

    let reads = Arc::new(AtomicUsize::new(0));
    counted_read(&cache, &gates, &path, &reads).await;
    assert_eq!(reads.load(Ordering::SeqCst), 1, "the raced read was served");
}

#[tokio::test]
async fn nothing_is_served_or_kept_while_an_indexing_job_runs() {
    let (_dir, path) = index();
    let (cache, gates) = (GenerationCache::new(1), IndexingSemaphores::new());
    let reads = Arc::new(AtomicUsize::new(0));
    counted_read(&cache, &gates, &path, &reads).await;

    for (rows, permit) in [gates.try_acquire_sessions(), gates.try_acquire_search()]
        .into_iter()
        .enumerate()
    {
        let _job = permit.unwrap();
        // A pass commits batches before it invalidates.
        index_tool_row(&path, "s1", "view");
        let before = reads.load(Ordering::SeqCst);
        assert_eq!(counted_read(&cache, &gates, &path, &reads).await, rows + 1);
        counted_read(&cache, &gates, &path, &reads).await;
        assert_eq!(reads.load(Ordering::SeqCst), before + 2);
        cache.invalidate();
    }

    counted_read(&cache, &gates, &path, &reads).await;
    let before = reads.load(Ordering::SeqCst);
    counted_read(&cache, &gates, &path, &reads).await;
    assert_eq!(
        reads.load(Ordering::SeqCst),
        before,
        "idle reads are cached"
    );
}

#[tokio::test]
async fn each_index_path_has_its_own_entry() {
    let ((_a, first), (_b, second)) = (index(), index());
    let (cache, gates) = (GenerationCache::new(2), IndexingSemaphores::new());
    index_tool_row(&first, "s1", "view");
    index_tool_row(&second, "s1", "edit");
    assert_eq!(tool_names(&cache, &gates, &first).await, ["view"]);
    assert_eq!(tool_names(&cache, &gates, &second).await, ["edit"]);
}

#[test]
fn unfiltered_facets_are_recognised_and_keys_follow_every_filter() {
    let filters = SearchFilters::default();
    assert!(is_unfiltered(&None, &filters));
    assert!(!is_unfiltered(&Some("needle".into()), &filters));

    let base = facets_cache_key(&None, &filters);
    let variants = [
        SearchFilters {
            content_types: vec!["tool_call".into()],
            ..Default::default()
        },
        SearchFilters {
            exclude_content_types: vec!["tool_call".into()],
            ..Default::default()
        },
        SearchFilters {
            repositories: vec!["repo".into()],
            ..Default::default()
        },
        SearchFilters {
            tool_names: vec!["view".into()],
            ..Default::default()
        },
        SearchFilters {
            session_id: Some("s1".into()),
            ..Default::default()
        },
        SearchFilters {
            source: Some(tracepilot_core::provider::SessionSource::ClaudeCode),
            ..Default::default()
        },
        SearchFilters {
            date_from_unix: Some(1),
            ..Default::default()
        },
        SearchFilters {
            date_to_unix: Some(1),
            ..Default::default()
        },
    ];
    for filtered in variants {
        assert!(!is_unfiltered(&None, &filtered));
        assert_ne!(facets_cache_key(&None, &filtered), base);
    }
}

/// A facets key whose hash always collides, as two distinct filter sets
/// could under a hashed key. Equality still compares the filter values.
#[derive(PartialEq, Eq)]
struct CollidingKey(FacetsKey);

impl Hash for CollidingKey {
    fn hash<H: std::hash::Hasher>(&self, _: &mut H) {}
}

#[tokio::test]
async fn filter_sets_whose_hashes_collide_keep_their_own_facets() {
    let (_dir, path) = index();
    index_tool_row(&path, "s1", "view");
    index_tool_row(&path, "s2", "edit");
    index_tool_row(&path, "s3", "edit");
    let (cache, gates) = (GenerationCache::new(2), IndexingSemaphores::new());
    let reads = Arc::new(AtomicUsize::new(0));
    let matches = |tool: &str| {
        let filters = SearchFilters {
            tool_names: vec![tool.to_string()],
            ..Default::default()
        };
        let key = CollidingKey(facets_cache_key(&None, &filters));
        let reads = Arc::clone(&reads);
        cached_index_read(&cache, &gates, path.clone(), key, move |db| {
            reads.fetch_add(1, Ordering::SeqCst);
            Ok(db.facets(None, &filters)?.total_matches)
        })
    };

    assert_eq!(matches("view").await.unwrap(), 1);
    assert_eq!(matches("edit").await.unwrap(), 2);
    // Both are now served from their own entries.
    assert_eq!(matches("view").await.unwrap(), 1);
    assert_eq!(matches("edit").await.unwrap(), 2);
    assert_eq!(reads.load(Ordering::SeqCst), 2);
}
