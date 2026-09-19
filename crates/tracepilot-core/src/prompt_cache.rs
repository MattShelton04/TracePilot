//! Prompt-cache insights reconstructed from persisted session events.
//!
//! Copilot CLI 1.0.75+ writes a `session.usage_checkpoint` whenever the agent
//! goes idle. It records the CLI's predicted prompt-cache expiry per model and
//! (1.0.83+) a fingerprint of the prompt prefix. This module turns those into
//! idle windows: when the cache was predicted to expire, whether the next
//! prompt came before or after that point, and which part of the prefix
//! changed in between.
//!
//! The event log cannot confirm per-request cache hits, so every window
//! carries a [`CacheConfidence`]: `Predicted` values come from the CLI,
//! `Estimated` ones from an idle gap plus a TTL observed elsewhere, and
//! `Unavailable` means nothing is claimed. Prefix changes are likely causes of
//! a cache break, not proof of one.

mod baseline;
mod builder;
mod changes;
mod model;
mod outcome;
mod state;

pub use baseline::{
    CacheBaseline, MAIN_CONVERSATION, ParsedBaselines, SegmentFingerprint, ToolFingerprint,
    parse_baselines,
};
pub use builder::build_prompt_cache_timeline;
pub use changes::{REDACTED_TOOL, diff_baselines};
pub use model::{
    CacheConfidence, CacheWindow, CacheWindowOutcome, ObservedCacheTtl, PrefixChange,
    PrefixChangeKind, PromptCacheSource, PromptCacheSummary, PromptCacheTimeline,
};

use chrono::{DateTime, Utc};

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

#[cfg(test)]
mod tests;
