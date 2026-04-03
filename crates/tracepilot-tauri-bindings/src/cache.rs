//! Generic TTL (time-to-live) cache implementation.
//!
//! Provides a thread-safe, concurrent cache with automatic expiration based on
//! time-to-live (TTL) durations. Backed by DashMap for lock-free concurrent access.

use dashmap::DashMap;
use std::hash::Hash;
use std::time::{Duration, Instant};

/// A thread-safe TTL (time-to-live) cache backed by DashMap.
///
/// Entries expire after the specified TTL duration. Expired entries are
/// automatically detected and ignored on access (lazy eviction).
///
/// # Type Parameters
///
/// - `K`: Key type, must be hashable and comparable
/// - `V`: Value type, must be cloneable for retrieval
///
/// # Examples
///
/// ```rust
/// use std::time::Duration;
/// use tracepilot_tauri_bindings::cache::TtlCache;
///
/// let cache = TtlCache::new(Duration::from_secs(60));
/// cache.insert("key", "value");
///
/// if let Some(value) = cache.get(&"key") {
///     println!("Found: {}", value);
/// }
/// ```
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
    ///
    /// # Arguments
    ///
    /// * `ttl` - Time-to-live duration for cached entries
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache: TtlCache<String, i32> = TtlCache::new(Duration::from_secs(300));
    /// ```
    pub const fn new(ttl: Duration) -> Self {
        Self {
            data: DashMap::new(),
            ttl,
        }
    }

    /// Get a value from cache if present and not expired.
    ///
    /// Returns `None` if:
    /// - The key doesn't exist
    /// - The entry has expired (older than TTL)
    ///
    /// # Arguments
    ///
    /// * `key` - The key to look up
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache = TtlCache::new(Duration::from_secs(60));
    /// cache.insert("user_id", 42);
    ///
    /// if let Some(id) = cache.get(&"user_id") {
    ///     println!("User ID: {}", id);
    /// }
    /// ```
    pub fn get(&self, key: &K) -> Option<V> {
        self.data.get(key).and_then(|entry| {
            let (ref value, timestamp) = *entry;
            if timestamp.elapsed() < self.ttl {
                Some(value.clone())
            } else {
                None
            }
        })
    }

    /// Insert or update a cache entry with the current timestamp.
    ///
    /// If the key already exists, it will be overwritten with the new value
    /// and the timestamp will be refreshed.
    ///
    /// # Arguments
    ///
    /// * `key` - The key to insert
    /// * `value` - The value to cache
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache = TtlCache::new(Duration::from_secs(60));
    /// cache.insert("token", "abc123");
    /// cache.insert("token", "xyz789"); // Updates existing entry
    /// ```
    pub fn insert(&self, key: K, value: V) {
        self.data.insert(key, (value, Instant::now()));
    }

    /// Remove a specific cache entry by key.
    ///
    /// Returns `true` if the entry was present and removed, `false` otherwise.
    ///
    /// # Arguments
    ///
    /// * `key` - The key to remove
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache = TtlCache::new(Duration::from_secs(60));
    /// cache.insert("temp", 123);
    /// cache.remove(&"temp");
    /// assert!(cache.get(&"temp").is_none());
    /// ```
    pub fn remove(&self, key: &K) -> bool {
        self.data.remove(key).is_some()
    }

    /// Clear all cache entries.
    ///
    /// Removes all entries from the cache regardless of expiration status.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache = TtlCache::new(Duration::from_secs(60));
    /// cache.insert("a", 1);
    /// cache.insert("b", 2);
    /// cache.clear();
    /// assert!(cache.get(&"a").is_none());
    /// assert!(cache.get(&"b").is_none());
    /// ```
    pub fn clear(&self) {
        self.data.clear();
    }

    /// Returns the number of entries currently in the cache.
    ///
    /// Note: This includes expired entries that haven't been accessed yet
    /// (lazy eviction), so the actual number of valid entries may be lower.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache = TtlCache::new(Duration::from_secs(60));
    /// cache.insert("x", 10);
    /// cache.insert("y", 20);
    /// assert_eq!(cache.len(), 2);
    /// ```
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Returns `true` if the cache contains no entries.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::time::Duration;
    /// use tracepilot_tauri_bindings::cache::TtlCache;
    ///
    /// let cache: TtlCache<String, i32> = TtlCache::new(Duration::from_secs(60));
    /// assert!(cache.is_empty());
    /// cache.insert("key".to_string(), 42);
    /// assert!(!cache.is_empty());
    /// ```
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_insert_and_get() {
        let cache = TtlCache::new(Duration::from_secs(60));
        cache.insert("key1", "value1");
        cache.insert("key2", 42);

        assert_eq!(cache.get(&"key1"), Some("value1"));
        assert_eq!(cache.get(&"key2"), Some(42));
        assert_eq!(cache.get(&"key3"), None);
    }

    #[test]
    fn test_expiration() {
        let cache = TtlCache::new(Duration::from_millis(50));
        cache.insert("temp", "expires-soon");

        // Should be available immediately
        assert_eq!(cache.get(&"temp"), Some("expires-soon"));

        // Wait for expiration
        thread::sleep(Duration::from_millis(100));

        // Should be expired now
        assert_eq!(cache.get(&"temp"), None);
    }

    #[test]
    fn test_update_refreshes_timestamp() {
        let cache = TtlCache::new(Duration::from_millis(100));
        cache.insert("key", "value1");

        thread::sleep(Duration::from_millis(60));
        cache.insert("key", "value2"); // Refresh timestamp

        thread::sleep(Duration::from_millis(60));
        // Should still be valid because we refreshed at 60ms
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

        // Removing non-existent key returns false
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
        use std::sync::Arc;

        let cache = Arc::new(TtlCache::new(Duration::from_secs(60)));
        let mut handles = vec![];

        // Spawn multiple threads inserting and reading
        for i in 0..10 {
            let cache_clone = Arc::clone(&cache);
            let handle = thread::spawn(move || {
                let key = format!("key{}", i);
                cache_clone.insert(key.clone(), i);
                cache_clone.get(&key)
            });
            handles.push(handle);
        }

        // Wait for all threads
        for handle in handles {
            let result = handle.join().unwrap();
            assert!(result.is_some());
        }
    }

    #[test]
    fn test_different_key_types() {
        // String keys
        let cache1 = TtlCache::new(Duration::from_secs(60));
        cache1.insert("string_key".to_string(), 42);
        assert_eq!(cache1.get(&"string_key".to_string()), Some(42));

        // Integer keys
        let cache2 = TtlCache::new(Duration::from_secs(60));
        cache2.insert(123_u64, "value");
        assert_eq!(cache2.get(&123_u64), Some("value"));

        // Tuple keys
        let cache3 = TtlCache::new(Duration::from_secs(60));
        cache3.insert(("a", 1), true);
        assert_eq!(cache3.get(&("a", 1)), Some(true));
    }
}
