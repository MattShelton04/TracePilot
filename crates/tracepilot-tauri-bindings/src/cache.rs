//! Shared cache helpers: compatibility re-export for the core TTL cache, plus
//! a generic [`build_session_lru`] constructor that centralises the
//! `NonZeroUsize` ceremony every Tauri-bindings LRU used to repeat.

use std::num::NonZeroUsize;

use lru::LruCache;

pub(crate) use tracepilot_core::utils::cache::TtlCache;

/// Build a typed, bounded LRU cache keyed by session ID.
///
/// Centralises the `NonZeroUsize::new(cap).unwrap_or(…)` ceremony that was
/// duplicated at each callsite in `lib.rs`. A capacity of zero falls back to
/// a single-slot cache rather than panicking, keeping behaviour robust even
/// if a configuration change ever drives the constant to zero.
pub(crate) fn build_session_lru<V>(cap: usize) -> LruCache<String, V> {
    let cap = NonZeroUsize::new(cap)
        .unwrap_or_else(|| NonZeroUsize::new(1).expect("1 is a valid NonZeroUsize"));
    LruCache::new(cap)
}

#[cfg(test)]
mod tests {
    use super::build_session_lru;

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
}
