//! Intermediate state collected while walking the event log.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::baseline::CacheBaseline;

/// A checkpoint's cache state for one model.
#[derive(Debug, Clone, Copy)]
pub(super) struct ModelExpiry {
    pub(super) expires_at: Option<DateTime<Utc>>,
    pub(super) ttl_seconds: Option<u64>,
}

#[derive(Debug)]
pub(super) struct Checkpoint {
    pub(super) total_nano_aiu: u64,
    pub(super) expiries: HashMap<String, ModelExpiry>,
    /// Main-conversation baselines keyed by model.
    pub(super) baselines: HashMap<String, CacheBaseline>,
    /// History-rewriting events since the previous checkpoint.
    pub(super) rewrite_causes: Vec<String>,
}

impl Checkpoint {
    /// The main-conversation baseline the session was using when it idled.
    pub(super) fn active_baseline(&self, current_model: Option<&str>) -> Option<&CacheBaseline> {
        current_model
            .and_then(|model| self.baselines.get(model))
            .or_else(|| self.baselines.values().max_by_key(|b| b.completed_at))
    }

    pub(super) fn expiry_for(&self, model: Option<&str>) -> Option<ModelExpiry> {
        let from_state = match model {
            Some(model) => self.expiries.get(model).copied(),
            None if self.expiries.len() == 1 => self.expiries.values().next().copied(),
            None => None,
        };
        from_state.or_else(|| {
            let baseline = self.baselines.get(model?)?;
            (baseline.cache_expires_at.is_some() || baseline.ttl_seconds.is_some()).then_some(
                ModelExpiry {
                    expires_at: baseline.cache_expires_at,
                    ttl_seconds: baseline.ttl_seconds,
                },
            )
        })
    }
}

#[derive(Debug)]
pub(super) struct Resume {
    pub(super) at: DateTime<Utc>,
    pub(super) event_index: usize,
    pub(super) interaction_id: Option<String>,
    pub(super) source: Option<String>,
    pub(super) model: Option<String>,
    pub(super) effort: Option<String>,
}

#[derive(Debug)]
pub(super) struct WindowDraft {
    pub(super) idle_start: DateTime<Utc>,
    /// Index into `Walker::checkpoints`; `None` for turn-gap windows.
    pub(super) start_checkpoint: Option<usize>,
    /// First checkpoint after the resume (closes the resumed interaction).
    pub(super) next_checkpoint: Option<usize>,
    pub(super) idle_model: Option<String>,
    pub(super) idle_effort: Option<String>,
    pub(super) resume: Option<Resume>,
    pub(super) idle_rewrite_causes: Vec<String>,
    pub(super) shutdown_while_idle: bool,
}
