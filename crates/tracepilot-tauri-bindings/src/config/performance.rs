//! Runtime performance and memory-retention settings.

use serde::{Deserialize, Serialize};

pub const DEFAULT_SESSION_CACHE_SIZE: usize = 10;
pub const MIN_SESSION_CACHE_SIZE: usize = 1;
pub const MAX_SESSION_CACHE_SIZE: usize = 100;

pub fn clamp_session_cache_size(value: usize) -> usize {
    value.clamp(MIN_SESSION_CACHE_SIZE, MAX_SESSION_CACHE_SIZE)
}

fn default_session_cache_size() -> usize {
    DEFAULT_SESSION_CACHE_SIZE
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceConfig {
    /// Maximum recent sessions retained by each navigation cache.
    #[serde(default = "default_session_cache_size")]
    pub session_cache_size: usize,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            session_cache_size: DEFAULT_SESSION_CACHE_SIZE,
        }
    }
}

impl PerformanceConfig {
    pub(super) fn normalize(&mut self) {
        self.session_cache_size = clamp_session_cache_size(self.session_cache_size);
    }
}
