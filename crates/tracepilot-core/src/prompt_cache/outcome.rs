//! Classification of finished windows and the session summary.

use chrono::{DateTime, Duration, Utc};

use super::baseline::CacheBaseline;
use super::changes::{diff_baselines, effort_change, model_change, rewrite_event_change};
use super::model::{
    CacheConfidence, CacheWindow, CacheWindowOutcome, PrefixChange, PrefixChangeKind,
    PromptCacheSummary,
};
use super::state::{Checkpoint, WindowDraft};

/// `CacheWindow::resume_source` for a model call the agent started itself.
pub const AGENT_RESUME_SOURCE: &str = "agent";

/// The cache timing of one window.
pub(super) struct Classification {
    pub(super) outcome: CacheWindowOutcome,
    pub(super) confidence: CacheConfidence,
    pub(super) expires_at: Option<DateTime<Utc>>,
    pub(super) ttl_seconds: Option<u64>,
}

pub(super) fn classify(
    draft: &WindowDraft,
    start: Option<&Checkpoint>,
    model: Option<&str>,
    estimated_ttl: &mut impl FnMut(&str) -> Option<u64>,
) -> Classification {
    let resume_at = draft.resume.as_ref().map(|r| r.at);
    let timed = |expires_at: DateTime<Utc>, ttl: Option<u64>, confidence| Classification {
        outcome: match resume_at {
            Some(at) if at < expires_at => CacheWindowOutcome::Warm,
            Some(_) => CacheWindowOutcome::Expired,
            None => pending_outcome(draft),
        },
        confidence,
        expires_at: Some(expires_at),
        ttl_seconds: ttl,
    };
    let no_cache = |confidence| Classification {
        outcome: if resume_at.is_some() {
            CacheWindowOutcome::NoCache
        } else {
            pending_outcome(draft)
        },
        confidence,
        expires_at: None,
        ttl_seconds: Some(0),
    };

    if let Some(checkpoint) = start {
        if let Some(expiry) = checkpoint.expiry_for(model) {
            return match (expiry.ttl_seconds, expiry.expires_at) {
                (Some(0), _) => no_cache(CacheConfidence::Predicted),
                (ttl, Some(expires_at)) => timed(expires_at, ttl, CacheConfidence::Predicted),
                (Some(ttl), None) => timed(
                    draft.idle_start + Duration::seconds(ttl as i64),
                    Some(ttl),
                    CacheConfidence::Estimated,
                ),
                (None, None) => unavailable(draft),
            };
        }
        if model.is_some() && !checkpoint.expiries.is_empty() {
            // The CLI tracked a cache, but not for the model now in use.
            return Classification {
                outcome: if resume_at.is_some() {
                    CacheWindowOutcome::ModelChanged
                } else {
                    pending_outcome(draft)
                },
                confidence: CacheConfidence::Predicted,
                expires_at: None,
                ttl_seconds: None,
            };
        }
    }

    // Estimated fallback: older CLI, or a checkpoint without cache state.
    match model.and_then(&mut *estimated_ttl) {
        Some(0) => no_cache(CacheConfidence::Estimated),
        Some(ttl) => timed(
            draft.idle_start + Duration::seconds(ttl as i64),
            Some(ttl),
            CacheConfidence::Estimated,
        ),
        None => unavailable(draft),
    }
}

fn unavailable(draft: &WindowDraft) -> Classification {
    Classification {
        outcome: if draft.resume.is_some() {
            CacheWindowOutcome::Unknown
        } else {
            pending_outcome(draft)
        },
        confidence: CacheConfidence::Unavailable,
        expires_at: None,
        ttl_seconds: None,
    }
}

fn pending_outcome(draft: &WindowDraft) -> CacheWindowOutcome {
    if draft.shutdown_while_idle {
        CacheWindowOutcome::SessionEnded
    } else {
        CacheWindowOutcome::Pending
    }
}

pub(super) fn prefix_changes(
    draft: &WindowDraft,
    start_baseline: Option<&CacheBaseline>,
    next: Option<&Checkpoint>,
) -> Vec<PrefixChange> {
    let resume_model = draft.resume.as_ref().and_then(|r| r.model.as_deref());
    let next_baseline = next.and_then(|c| c.active_baseline(resume_model));

    let mut changes = match (start_baseline, next_baseline, next) {
        (Some(prev), Some(next_baseline), Some(next)) => {
            let mut changes = diff_baselines(prev, next_baseline, &draft.idle_rewrite_causes);
            // A rewrite whose only known causes came after the resume (e.g. a
            // compaction during the next interaction) cannot have broken it.
            if draft.idle_rewrite_causes.is_empty() && !next.rewrite_causes.is_empty() {
                changes.retain(|change| change.kind != PrefixChangeKind::History);
            }
            changes
        }
        _ => {
            // No fingerprints on both sides: rely on events seen while idle.
            if draft.idle_rewrite_causes.is_empty() {
                Vec::new()
            } else {
                vec![rewrite_event_change(&draft.idle_rewrite_causes)]
            }
        }
    };

    let has = |changes: &[PrefixChange], kind| changes.iter().any(|c| c.kind == kind);
    if let Some(resume) = &draft.resume {
        if let (Some(from), Some(to)) = (&draft.idle_model, &resume.model)
            && from != to
            && !has(&changes, PrefixChangeKind::Model)
        {
            changes.insert(0, model_change(from, to));
        }
        if let (Some(from), Some(to)) = (&draft.idle_effort, &resume.effort)
            && from != to
            && !has(&changes, PrefixChangeKind::Model)
            && !has(&changes, PrefixChangeKind::Effort)
        {
            changes.push(effort_change(from, to));
        }
    }
    changes
}

pub(super) fn summarize(windows: &[CacheWindow]) -> PromptCacheSummary {
    let mut summary = PromptCacheSummary::default();
    let mut idle: Vec<u64> = Vec::new();
    for window in windows.iter().filter(|w| w.resume_at.is_some()) {
        if matches!(
            window.outcome,
            CacheWindowOutcome::Expired | CacheWindowOutcome::ModelChanged
        ) {
            summary.resent_prefix_tokens += window.prefix_tokens.unwrap_or(0);
        }
        // An agent waking itself (e.g. a background task finished) is not a
        // reply, so it stays out of the reply figures.
        if window.resume_source.as_deref() == Some(AGENT_RESUME_SOURCE) {
            summary.agent_resumes += 1;
            continue;
        }
        summary.resumed_windows += 1;
        match window.outcome {
            CacheWindowOutcome::Warm => summary.warm += 1,
            CacheWindowOutcome::Expired => summary.expired += 1,
            CacheWindowOutcome::ModelChanged => summary.model_changed += 1,
            CacheWindowOutcome::NoCache => summary.no_cache += 1,
            _ => summary.unknown += 1,
        }
        if !window.prefix_changes.is_empty() {
            summary.likely_breaks += 1;
        }
        idle.extend(window.idle_seconds);
    }
    summary.median_idle_seconds = median(&mut idle);
    summary
}

/// Upper median, so a two-element set reports an observed value.
pub(super) fn median(values: &mut [u64]) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    Some(values[values.len() / 2])
}
