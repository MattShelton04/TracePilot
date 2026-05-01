use crate::error::Result;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;
use tracepilot_core::utils::cache::TtlCache;

const DISK_USAGE_TTL: Duration = Duration::from_secs(60);

static DISK_USAGE_CACHE: LazyLock<TtlCache<String, u64>> =
    LazyLock::new(|| TtlCache::new(DISK_USAGE_TTL));

fn disk_usage_cache_key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

/// Invalidate the disk-usage cache entry for a specific path.
pub fn invalidate_disk_usage_cache(path: &Path) {
    DISK_USAGE_CACHE.remove(&disk_usage_cache_key(path));
}

/// Get disk usage of a path (fully recursive), with a 30-second TTL cache.
pub fn disk_usage_bytes(path: &Path) -> Result<u64> {
    let key = disk_usage_cache_key(path);

    if let Some(bytes) = DISK_USAGE_CACHE.get(&key) {
        return Ok(bytes);
    }

    let mut total: u64 = 0;
    if path.is_dir() {
        for entry in walkdir::WalkDir::new(path)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }

    DISK_USAGE_CACHE.insert(key, total);
    Ok(total)
}
