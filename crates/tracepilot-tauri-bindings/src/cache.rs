//! Shared cache helpers: a generic [`build_session_lru`] constructor that
//! centralises the `NonZeroUsize` ceremony every Tauri-bindings LRU used to
//! repeat, and [`GenerationCache`] for reads that hold until invalidated.

use std::hash::Hash;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use lru::LruCache;

/// Build a typed, bounded LRU cache keyed by session ID.
///
/// Centralises the `NonZeroUsize::new(cap).unwrap_or(…)` ceremony that was
/// duplicated at each callsite in `lib.rs`. A capacity of zero falls back to
/// a single-slot cache rather than panicking, keeping behaviour robust even
/// if a configuration change ever drives the constant to zero.
pub(crate) fn build_session_lru<V>(cap: usize) -> LruCache<String, V> {
    let cap = nonzero_capacity(cap);
    LruCache::new(cap)
}

/// Resize a session LRU, evicting least-recently-used entries when shrinking.
pub(crate) fn resize_session_lru<V>(cache: &mut LruCache<String, V>, cap: usize) {
    cache.resize(nonzero_capacity(cap));
}

fn nonzero_capacity(cap: usize) -> NonZeroUsize {
    NonZeroUsize::new(cap).unwrap_or(NonZeroUsize::MIN)
}

/// A bounded LRU of values that stay valid until [`Self::invalidate`].
///
/// A caller captures [`Self::generation`] before reading and stores the value
/// under it. Only values stored under the current generation are served, so a
/// read that raced an invalidation is never served afterwards.
pub(crate) struct GenerationCache<K: Hash + Eq, V> {
    generation: AtomicU64,
    entries: Mutex<LruCache<K, (u64, V)>>,
}

impl<K: Hash + Eq, V: Clone> GenerationCache<K, V> {
    pub(crate) fn new(cap: usize) -> Self {
        Self {
            generation: AtomicU64::new(0),
            entries: Mutex::new(LruCache::new(nonzero_capacity(cap))),
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    /// The value stored under the current generation, if any.
    pub(crate) fn get(&self, key: &K) -> Option<V> {
        let generation = self.generation();
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries
            .get(key)
            .filter(|(stored, _)| *stored == generation)
            .map(|(_, value)| value.clone())
    }

    /// Store a value read under `generation`; dropped if that is stale.
    pub(crate) fn insert(&self, generation: u64, key: K, value: V) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if generation == self.generation() {
            entries.put(key, (generation, value));
        }
    }

    /// Drop every value, including any read now in flight.
    pub(crate) fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{GenerationCache, build_session_lru, resize_session_lru};

    #[test]
    fn generation_cache_serves_until_invalidated() {
        let cache = GenerationCache::<&str, u32>::new(4);
        let generation = cache.generation();
        cache.insert(generation, "a", 1);
        assert_eq!(cache.get(&"a"), Some(1));

        cache.invalidate();
        assert_eq!(cache.get(&"a"), None);
    }

    #[test]
    fn generation_cache_drops_a_read_that_raced_an_invalidation() {
        let cache = GenerationCache::<&str, u32>::new(4);
        let before = cache.generation();
        cache.invalidate();
        cache.insert(before, "a", 1);
        assert_eq!(cache.get(&"a"), None);
    }

    #[test]
    fn generation_cache_is_bounded() {
        let cache = GenerationCache::<u32, u32>::new(2);
        let generation = cache.generation();
        for key in 0..3 {
            cache.insert(generation, key, key);
        }
        assert_eq!(cache.get(&0), None);
        assert_eq!(cache.get(&2), Some(2));
    }

    #[test]
    fn build_session_lru_honours_capacity() {
        let mut cache = build_session_lru::<u32>(2);
        cache.put("a".to_string(), 1);
        cache.put("b".to_string(), 2);
        cache.put("c".to_string(), 3);
        // Oldest entry ("a") must have been evicted at capacity 2.
        assert_eq!(cache.len(), 2);
        assert!(cache.get(&"a".to_string()).is_none());
        assert_eq!(cache.get(&"b".to_string()).copied(), Some(2));
        assert_eq!(cache.get(&"c".to_string()).copied(), Some(3));
    }

    #[test]
    fn build_session_lru_falls_back_on_zero_capacity() {
        // Zero capacity is normally illegal for LruCache; the helper must fall
        // back to a single-slot cache rather than panicking.
        let mut cache = build_session_lru::<u32>(0);
        cache.put("a".to_string(), 1);
        cache.put("b".to_string(), 2);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.get(&"b".to_string()).copied(), Some(2));
    }

    #[test]
    fn resize_session_lru_evicts_least_recent_entries() {
        let mut cache = build_session_lru::<u32>(3);
        cache.put("a".to_string(), 1);
        cache.put("b".to_string(), 2);
        cache.put("c".to_string(), 3);
        let _ = cache.get(&"a".to_string());

        resize_session_lru(&mut cache, 2);

        assert_eq!(cache.len(), 2);
        assert!(cache.get(&"b".to_string()).is_none());
        assert_eq!(cache.get(&"a".to_string()).copied(), Some(1));
        assert_eq!(cache.get(&"c".to_string()).copied(), Some(3));
    }
}
