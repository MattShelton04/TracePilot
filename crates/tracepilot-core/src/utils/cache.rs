//! Generic TTL (time-to-live) cache implementation.

use dashmap::DashMap;
use std::hash::Hash;
use std::time::{Duration, Instant};

/// A thread-safe TTL (time-to-live) cache backed by DashMap.
///
/// Entries expire after the specified TTL duration. Expired entries are
/// automatically detected and ignored on access (lazy eviction).
pub struct TtlCache<K, V> {
    data: DashMap<K, (V, Instant)>,
    ttl: Duration,
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
        self.data.insert(key, (value, Instant::now()));
    }

    /// Remove a specific cache entry by key.
    pub fn remove(&self, key: &K) -> bool {
        self.data.remove(key).is_some()
    }

    /// Clear all cache entries.
    pub fn clear(&self) {
        self.data.clear();
    }

    /// Returns the number of entries currently in the cache.
    ///
    /// Note: This may include expired entries that haven't been accessed
    /// yet via `get()`. Entries are evicted lazily on access.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Returns `true` if the cache contains no entries.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
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
    fn test_lazy_eviction_behavior() {
        let cache = TtlCache::new(Duration::from_millis(100));
        cache.insert("a", 1);
        cache.insert("b", 2);

        thread::sleep(Duration::from_millis(200));

        assert_eq!(cache.len(), 2);
        assert!(!cache.is_empty());

        assert_eq!(cache.get(&"a"), None);
        assert_eq!(cache.len(), 1);

        assert_eq!(cache.get(&"b"), None);
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }
}
