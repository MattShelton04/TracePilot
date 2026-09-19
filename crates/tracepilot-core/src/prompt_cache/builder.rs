//! Single linear pass over typed events that reconstructs idle windows.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde_json::Value;

use super::baseline::{CacheBaseline, MAIN_CONVERSATION, parse_baselines};
use super::changes::{diff_baselines, effort_change, model_change, rewrite_event_change};
use super::model::{
    CacheConfidence, CacheWindow, CacheWindowOutcome, ObservedCacheTtl, PrefixChange,
    PrefixChangeKind, PromptCacheSource, PromptCacheSummary, PromptCacheTimeline,
};
use super::parse_timestamp;
use crate::models::event_types::{ModelCacheState, SessionEventType, UsageCheckpointData};
use crate::parsing::events::{TypedEvent, TypedEventData};

/// Build the prompt-cache timeline for one session.
///
/// `estimated_ttl` supplies a TTL (seconds) for a model when the session has
/// no checkpoint for it. It is only consulted for the estimated fallback, so
/// callers can load it lazily. Return `None` when no TTL is known: the window
/// is then reported as unavailable instead of guessed.
pub fn build_prompt_cache_timeline(
    events: &[TypedEvent],
    mut estimated_ttl: impl FnMut(&str) -> Option<u64>,
) -> PromptCacheTimeline {
    let mut walker = Walker::default();
    for (index, event) in events.iter().enumerate() {
        walker.process(index, event);
    }
    walker.finish(&mut estimated_ttl)
}

/// A checkpoint's cache state for one model.
#[derive(Debug, Clone, Copy)]
struct ModelExpiry {
    expires_at: Option<DateTime<Utc>>,
    ttl_seconds: Option<u64>,
}

#[derive(Debug)]
struct Checkpoint {
    total_nano_aiu: u64,
    expiries: HashMap<String, ModelExpiry>,
    /// Main-conversation baselines keyed by model.
    baselines: HashMap<String, CacheBaseline>,
    /// History-rewriting events since the previous checkpoint.
    rewrite_causes: Vec<String>,
}

impl Checkpoint {
    /// The main-conversation baseline the session was using when it idled.
    fn active_baseline(&self, current_model: Option<&str>) -> Option<&CacheBaseline> {
        current_model
            .and_then(|model| self.baselines.get(model))
            .or_else(|| self.baselines.values().max_by_key(|b| b.completed_at))
    }

    fn expiry_for(&self, model: Option<&str>) -> Option<ModelExpiry> {
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
struct Resume {
    at: DateTime<Utc>,
    event_index: usize,
    interaction_id: Option<String>,
    source: Option<String>,
    model: Option<String>,
    effort: Option<String>,
}

#[derive(Debug)]
struct WindowDraft {
    idle_start: DateTime<Utc>,
    /// Index into `Walker::checkpoints`; `None` for turn-gap windows.
    start_checkpoint: Option<usize>,
    /// First checkpoint after the resume (closes the resumed interaction).
    next_checkpoint: Option<usize>,
    idle_model: Option<String>,
    idle_effort: Option<String>,
    resume: Option<Resume>,
    idle_rewrite_causes: Vec<String>,
    shutdown_while_idle: bool,
}

#[derive(Default)]
struct Walker {
    checkpoints: Vec<Checkpoint>,
    drafts: Vec<WindowDraft>,
    current_model: Option<String>,
    current_effort: Option<String>,
    last_turn_end: Option<DateTime<Utc>>,
    last_interaction_id: Option<String>,
    rewrite_causes: Vec<String>,
    observed_ttls: BTreeMap<(String, u64), usize>,
    malformed: usize,
    baseline_count: usize,
}

impl Walker {
    fn pending_draft(&mut self) -> Option<&mut WindowDraft> {
        self.drafts
            .last_mut()
            .filter(|draft| draft.resume.is_none())
    }

    fn process(&mut self, index: usize, event: &TypedEvent) {
        // Sub-agents run their own conversations; only the root agent's
        // prompts and model settings shape the main prompt cache.
        let is_main = event.raw.agent_id.is_none();
        let timestamp = event.raw.timestamp;
        match &event.typed_data {
            TypedEventData::SessionStart(data) => {
                set_if_some(&mut self.current_model, &data.selected_model);
                set_if_some(&mut self.current_effort, &data.reasoning_effort);
            }
            TypedEventData::SessionResume(data) => {
                set_if_some(&mut self.current_model, &data.selected_model);
                set_if_some(&mut self.current_effort, &data.reasoning_effort);
            }
            TypedEventData::ModelChange(data) if is_main => {
                set_if_some(&mut self.current_model, &data.new_model);
                set_if_some(&mut self.current_effort, &data.reasoning_effort);
            }
            TypedEventData::TurnStart(data) if is_main => {
                set_if_some(&mut self.current_model, &data.model);
                // The agent can wake without a prompt, e.g. when a background
                // sub-agent finishes. That model call resumes the cache too.
                if let Some(at) = timestamp {
                    self.record_agent_wake(index, at, data.interaction_id.clone());
                }
            }
            TypedEventData::TurnEnd(_) if is_main => self.last_turn_end = timestamp,
            TypedEventData::CompactionComplete(data) if is_main && data.success != Some(false) => {
                self.record_rewrite("compaction");
            }
            TypedEventData::SessionTruncation(_) if is_main => self.record_rewrite("truncation"),
            TypedEventData::SessionContextCleared(_) if is_main => {
                self.record_rewrite("context cleared");
            }
            TypedEventData::SessionShutdown(_) => {
                if let Some(draft) = self.pending_draft() {
                    draft.shutdown_while_idle = true;
                }
            }
            TypedEventData::SessionUsageCheckpoint(data) => {
                if let Some(at) = timestamp {
                    self.record_checkpoint(at, data);
                }
            }
            TypedEventData::Other(value)
                if event.event_type == SessionEventType::SessionUsageCheckpoint =>
            {
                // The typed parse failed (schema drift). Read what we can.
                if let Some(at) = timestamp {
                    let (data, malformed) = lenient_checkpoint(value);
                    self.malformed += malformed;
                    self.record_checkpoint(at, &data);
                }
            }
            TypedEventData::UserMessage(data) if is_main => {
                if let Some(at) = timestamp {
                    self.record_user_message(
                        index,
                        at,
                        data.interaction_id.clone(),
                        data.source.clone(),
                    );
                }
            }
            _ => {}
        }
    }

    fn record_rewrite(&mut self, cause: &str) {
        self.rewrite_causes.push(cause.to_string());
        if let Some(draft) = self.pending_draft() {
            draft.idle_rewrite_causes.push(cause.to_string());
        }
    }

    fn record_checkpoint(&mut self, at: DateTime<Utc>, data: &UsageCheckpointData) {
        let mut expiries = HashMap::new();
        for state in data.model_cache_state.iter().flatten() {
            let Some(model) = state.model_id.clone().filter(|m| !m.is_empty()) else {
                self.malformed += 1;
                continue;
            };
            if let Some(ttl) = state.cache_ttl_seconds {
                *self.observed_ttls.entry((model.clone(), ttl)).or_default() += 1;
            }
            expiries.insert(
                model,
                ModelExpiry {
                    expires_at: state.cache_expires_at.as_deref().and_then(parse_timestamp),
                    ttl_seconds: state.cache_ttl_seconds,
                },
            );
        }

        let parsed = parse_baselines(data.prompt_cache_break_state.as_deref().unwrap_or(&[]));
        self.malformed += parsed.malformed;
        let baselines: HashMap<String, CacheBaseline> = parsed
            .baselines
            .into_iter()
            .filter(|baseline| baseline.conversation == MAIN_CONVERSATION)
            .map(|baseline| (baseline.model.clone(), baseline))
            .collect();
        self.baseline_count += baselines.len();

        let checkpoint_index = self.checkpoints.len();
        let checkpoint = Checkpoint {
            total_nano_aiu: data.total_nano_aiu,
            expiries,
            baselines,
            rewrite_causes: std::mem::take(&mut self.rewrite_causes),
        };
        let idle_baseline = checkpoint.active_baseline(self.current_model.as_deref());
        let idle_model = idle_baseline
            .map(|b| b.model.clone())
            .or_else(|| self.current_model.clone());
        let idle_effort = idle_baseline
            .and_then(|b| b.reasoning_effort.clone())
            .or_else(|| self.current_effort.clone());
        self.checkpoints.push(checkpoint);

        // Close the interaction that followed the previous resume.
        if let Some(draft) = self.drafts.last_mut()
            && draft.resume.is_some()
            && draft.next_checkpoint.is_none()
            && draft.start_checkpoint.is_some()
        {
            draft.next_checkpoint = Some(checkpoint_index);
        }

        let fresh = WindowDraft {
            idle_start: at,
            start_checkpoint: Some(checkpoint_index),
            next_checkpoint: None,
            idle_model,
            idle_effort,
            resume: None,
            idle_rewrite_causes: Vec::new(),
            shutdown_while_idle: false,
        };
        // A later checkpoint without a main prompt in between (e.g. the agent
        // continued after a background task) supersedes the idle point.
        match self.pending_draft() {
            Some(draft) => *draft = fresh,
            None => self.drafts.push(fresh),
        }
    }

    fn record_agent_wake(
        &mut self,
        event_index: usize,
        at: DateTime<Utc>,
        interaction_id: Option<String>,
    ) {
        let resume = self.resume_at(event_index, at, interaction_id, Some("agent".into()));
        if let Some(draft) = self.pending_draft() {
            draft.resume = Some(resume);
        }
    }

    fn resume_at(
        &self,
        event_index: usize,
        at: DateTime<Utc>,
        interaction_id: Option<String>,
        source: Option<String>,
    ) -> Resume {
        Resume {
            at,
            event_index,
            interaction_id,
            source,
            model: self.current_model.clone(),
            effort: self.current_effort.clone(),
        }
    }

    fn record_user_message(
        &mut self,
        event_index: usize,
        at: DateTime<Utc>,
        interaction_id: Option<String>,
        source: Option<String>,
    ) {
        let resume = self.resume_at(
            event_index,
            at,
            interaction_id.clone(),
            source.filter(|s| s != "user"),
        );
        let continues_interaction =
            interaction_id.is_some() && interaction_id == self.last_interaction_id;
        if let Some(draft) = self.pending_draft() {
            draft.resume = Some(resume);
        } else if self.checkpoints.is_empty()
            && !continues_interaction
            && let Some(idle_start) = self.last_turn_end
        {
            // Older CLIs: no checkpoints, so use the gap after the last turn.
            self.drafts.push(WindowDraft {
                idle_start,
                start_checkpoint: None,
                next_checkpoint: None,
                idle_model: resume.model.clone(),
                idle_effort: resume.effort.clone(),
                resume: Some(resume),
                idle_rewrite_causes: Vec::new(),
                shutdown_while_idle: false,
            });
        }
        self.last_turn_end = None;
        if interaction_id.is_some() {
            self.last_interaction_id = interaction_id;
        }
    }

    fn finish(self, estimated_ttl: &mut impl FnMut(&str) -> Option<u64>) -> PromptCacheTimeline {
        let windows: Vec<CacheWindow> = self
            .drafts
            .iter()
            .enumerate()
            .map(|(index, draft)| self.finalize(index, draft, estimated_ttl))
            .collect();
        let source = if !self.checkpoints.is_empty() {
            PromptCacheSource::Checkpoints
        } else if !windows.is_empty() {
            PromptCacheSource::TurnGaps
        } else {
            PromptCacheSource::None
        };
        PromptCacheTimeline {
            source,
            checkpoint_count: self.checkpoints.len(),
            baseline_count: self.baseline_count,
            malformed_entry_count: self.malformed,
            summary: summarize(&windows),
            observed_ttls: self
                .observed_ttls
                .into_iter()
                .map(|((model, ttl_seconds), count)| ObservedCacheTtl {
                    model,
                    ttl_seconds,
                    count,
                })
                .collect(),
            windows,
        }
    }

    fn finalize(
        &self,
        index: usize,
        draft: &WindowDraft,
        estimated_ttl: &mut impl FnMut(&str) -> Option<u64>,
    ) -> CacheWindow {
        let start = draft.start_checkpoint.map(|i| &self.checkpoints[i]);
        let next = draft.next_checkpoint.map(|i| &self.checkpoints[i]);
        let model = match &draft.resume {
            Some(resume) => resume.model.clone().or_else(|| draft.idle_model.clone()),
            // While idle, the cache that matters is the one the session built.
            None => draft
                .idle_model
                .clone()
                .or_else(|| self.current_model.clone()),
        };

        let classification = classify(draft, start, model.as_deref(), estimated_ttl);
        let resume_at = draft.resume.as_ref().map(|r| r.at);
        let start_baseline = start.and_then(|c| c.active_baseline(draft.idle_model.as_deref()));

        CacheWindow {
            index,
            idle_start: format_ts(draft.idle_start),
            resume_at: resume_at.map(format_ts),
            idle_seconds: resume_at.map(|at| clamp_seconds(at - draft.idle_start)),
            model,
            expires_at: classification.expires_at.map(format_ts),
            ttl_seconds: classification.ttl_seconds,
            outcome: classification.outcome,
            confidence: classification.confidence,
            resume_offset_seconds: resume_at
                .zip(classification.expires_at)
                .map(|(at, expires)| (at - expires).num_seconds()),
            resume_event_index: draft.resume.as_ref().map(|r| r.event_index),
            resume_interaction_id: draft.resume.as_ref().and_then(|r| r.interaction_id.clone()),
            resume_source: draft.resume.as_ref().and_then(|r| r.source.clone()),
            prefix_tokens: start_baseline.and_then(|b| b.frontier_tokens.or(b.prompt_tokens)),
            interaction_nano_aiu: start
                .zip(next)
                .map(|(s, n)| n.total_nano_aiu.saturating_sub(s.total_nano_aiu)),
            prefix_changes: prefix_changes(draft, start_baseline, next),
        }
    }
}

struct Classification {
    outcome: CacheWindowOutcome,
    confidence: CacheConfidence,
    expires_at: Option<DateTime<Utc>>,
    ttl_seconds: Option<u64>,
}

fn classify(
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

fn prefix_changes(
    draft: &WindowDraft,
    start_baseline: Option<&CacheBaseline>,
    next: Option<&Checkpoint>,
) -> Vec<PrefixChange> {
    let resume_model = draft.resume.as_ref().and_then(|r| r.model.as_deref());
    let next_baseline = next.and_then(|c| c.active_baseline(resume_model));

    let mut changes = match (start_baseline, next_baseline, next) {
        (Some(prev), Some(next_baseline), Some(next)) => {
            diff_baselines(prev, next_baseline, &next.rewrite_causes)
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

fn summarize(windows: &[CacheWindow]) -> PromptCacheSummary {
    let mut summary = PromptCacheSummary::default();
    let mut idle: Vec<u64> = Vec::new();
    for window in windows.iter().filter(|w| w.resume_at.is_some()) {
        summary.resumed_windows += 1;
        match window.outcome {
            CacheWindowOutcome::Warm => summary.warm += 1,
            CacheWindowOutcome::Expired => summary.expired += 1,
            CacheWindowOutcome::ModelChanged => summary.model_changed += 1,
            CacheWindowOutcome::NoCache => summary.no_cache += 1,
            _ => summary.unknown += 1,
        }
        if matches!(
            window.outcome,
            CacheWindowOutcome::Expired | CacheWindowOutcome::ModelChanged
        ) {
            summary.resent_prefix_tokens += window.prefix_tokens.unwrap_or(0);
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
pub(crate) fn median(values: &mut [u64]) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    Some(values[values.len() / 2])
}

/// Parse a checkpoint whose typed deserialization failed, keeping whatever
/// entries are readable. Returns the data and the number of skipped entries.
fn lenient_checkpoint(value: &Value) -> (UsageCheckpointData, usize) {
    let mut malformed = 0;
    let model_cache_state = value
        .get("modelCacheState")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let parsed = serde_json::from_value::<ModelCacheState>(entry.clone()).ok();
                    if parsed.is_none() {
                        malformed += 1;
                    }
                    parsed
                })
                .collect()
        });
    let data = UsageCheckpointData {
        total_nano_aiu: value
            .get("totalNanoAiu")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        total_premium_requests: value.get("totalPremiumRequests").and_then(Value::as_f64),
        model_cache_state,
        prompt_cache_break_state: value
            .get("promptCacheBreakState")
            .and_then(Value::as_array)
            .cloned(),
    };
    (data, malformed)
}

fn set_if_some(target: &mut Option<String>, value: &Option<String>) {
    if let Some(value) = value.as_ref().filter(|v| !v.is_empty()) {
        *target = Some(value.clone());
    }
}

fn clamp_seconds(duration: Duration) -> u64 {
    duration.num_seconds().max(0) as u64
}

fn format_ts(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}
