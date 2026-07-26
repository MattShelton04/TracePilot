//! Generic TTL (time-to-live) cache implementation.

use dashmap::DashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const PRUNE_EVERY_N_INSERTS: usize = 64;

/// A thread-safe TTL (time-to-live) cache backed by DashMap.
///
/// Entries expire after the specified TTL duration. Expired entries are
/// removed on access and opportunistically pruned during inspection and
/// periodically during writes.
pub struct TtlCache<K, V> {
    data: DashMap<K, (V, Instant)>,
    ttl: Duration,
    insert_count: AtomicUsize,
}

impl<K, V> TtlCache<K, V>
where
    K: Hash + Eq,
    V: Clone,
{
    /// Create a new TTL cache with the specified duration.
    pub fn new(ttl: Duration) -> Self {
        Self {
            data: DashMap::new(),
            ttl,
            insert_count: AtomicUsize::new(0),
        }
    }

    /// Get a value from cache if present and not expired.
    pub fn get(&self, key: &K) -> Option<V> {
        let entry = self.data.get(key)?;
        let (ref value, timestamp) = *entry;
        if timestamp.elapsed() < self.ttl {
            Some(value.clone())
        } else {
            drop(entry);
            self.data.remove(key);
            None
        }
    }

    /// Insert or update a cache entry with the current timestamp.
    pub fn insert(&self, key: K, value: V) {
        // DashMap::retain visits and write-locks every shard. Amortize that
        // cost instead of turning every otherwise O(1) insert into a full-map
        // scan. Exact-key reads still remove expired entries immediately, and
        // len/is_empty always prune before reporting.
        let insert_index = self.insert_count.fetch_add(1, Ordering::Relaxed);
        if insert_index % PRUNE_EVERY_N_INSERTS == PRUNE_EVERY_N_INSERTS - 1 {
            self.prune_expired();
        }
        self.data.insert(key, (value, Instant::now()));
    }

    /// Remove a specific cache entry by key.
    pub fn remove(&self, key: &K) -> bool {
        self.data.remove(key).is_some()
    }

    /// Clear all cache entries.
    pub fn clear(&self) {
        self.data.clear();
        self.insert_count.store(0, Ordering::Relaxed);
    }

    /// Returns the number of unexpired entries currently in the cache.
    pub fn len(&self) -> usize {
        self.prune_expired();
        self.data.len()
    }

    /// Returns `true` if the cache contains no entries.
    pub fn is_empty(&self) -> bool {
        self.prune_expired();
        self.data.is_empty()
    }

    fn prune_expired(&self) {
        let ttl = self.ttl;
        self.data
            .retain(|_, (_, inserted_at)| inserted_at.elapsed() < ttl);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn test_insert_and_get() {
        let cache = TtlCache::new(Duration::from_secs(60));
        cache.insert("key1", "value1");
        cache.insert("key2", "value2");

        assert_eq!(cache.get(&"key1"), Some("value1"));
        assert_eq!(cache.get(&"key2"), Some("value2"));
        assert_eq!(cache.get(&"key3"), None);
    }

    #[test]
    fn test_expiration() {
        let cache = TtlCache::new(Duration::from_millis(100));
        cache.insert("temp", "expires-soon");

        assert_eq!(cache.get(&"temp"), Some("expires-soon"));
        thread::sleep(Duration::from_millis(200));
        assert_eq!(cache.get(&"temp"), None);
    }

    #[test]
    fn test_update_refreshes_timestamp() {
        let cache = TtlCache::new(Duration::from_millis(150));
        cache.insert("key", "value1");

        thread::sleep(Duration::from_millis(100));
        cache.insert("key", "value2");

        thread::sleep(Duration::from_millis(100));
        assert_eq!(cache.get(&"key"), Some("value2"));
    }

    #[test]
    fn test_clear() {
        let cache = TtlCache::new(Duration::from_secs(60));
        cache.insert("a", 1);
        cache.insert("b", 2);
        cache.insert("c", 3);

        assert_eq!(cache.len(), 3);
        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
        assert_eq!(cache.get(&"a"), None);
    }

    #[test]
    fn test_remove() {
        let cache = TtlCache::new(Duration::from_secs(60));
        cache.insert("x", 10);
        cache.insert("y", 20);

        assert!(cache.remove(&"x"));
        assert_eq!(cache.get(&"x"), None);
        assert_eq!(cache.get(&"y"), Some(20));
        assert!(!cache.remove(&"z"));
    }

    #[test]
    fn test_len_and_is_empty() {
        let cache: TtlCache<&str, i32> = TtlCache::new(Duration::from_secs(60));
        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);

        cache.insert("a", 1);
        assert!(!cache.is_empty());
        assert_eq!(cache.len(), 1);

        cache.insert("b", 2);
        assert_eq!(cache.len(), 2);

        cache.clear();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_concurrent_access() {
        let cache = Arc::new(TtlCache::new(Duration::from_secs(60)));
        let mut handles = vec![];

        for i in 0..10 {
            let cache_clone = Arc::clone(&cache);
            let handle = thread::spawn(move || {
                let key = format!("key{}", i);
                cache_clone.insert(key.clone(), i);
                cache_clone.get(&key)
            });
            handles.push(handle);
        }

        for handle in handles {
            let result = handle.join().unwrap();
            assert!(result.is_some());
        }
    }

    #[test]
    fn test_different_key_types() {
        let cache1 = TtlCache::new(Duration::from_secs(60));
        cache1.insert("string_key".to_string(), 42);
        assert_eq!(cache1.get(&"string_key".to_string()), Some(42));

        let cache2 = TtlCache::new(Duration::from_secs(60));
        cache2.insert(123_u64, "value");
        assert_eq!(cache2.get(&123_u64), Some("value"));

        let cache3 = TtlCache::new(Duration::from_secs(60));
        cache3.insert(("a", 1), true);
        assert_eq!(cache3.get(&("a", 1)), Some(true));
    }

    #[test]
    fn test_expired_entries_are_pruned_during_inspection() {
        let cache = TtlCache::new(Duration::from_millis(100));
        cache.insert("a", 1);
        cache.insert("b", 2);

        thread::sleep(Duration::from_millis(200));

        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
        assert_eq!(cache.get(&"a"), None);
        assert_eq!(cache.get(&"b"), None);
    }

    #[test]
    fn test_insert_prunes_expired_other_keys() {
        let cache = TtlCache::new(Duration::from_millis(100));
        cache.insert("old-a".to_string(), 1);
        cache.insert("old-b".to_string(), 2);

        thread::sleep(Duration::from_millis(200));
        for i in 0..(PRUNE_EVERY_N_INSERTS - 2) {
            cache.insert(format!("fresh-{i}"), i);
        }

        // Inspect the backing map directly so len() cannot be the operation
        // that makes this assertion pass.
        assert_eq!(cache.data.len(), PRUNE_EVERY_N_INSERTS - 2);
        assert_eq!(cache.get(&"fresh-61".to_string()), Some(61));
    }
}
