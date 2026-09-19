//! Single linear pass over typed events that reconstructs idle windows.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde_json::Value;

use super::baseline::{CacheBaseline, MAIN_CONVERSATION, parse_baselines};
use super::model::{CacheWindow, ObservedCacheTtl, PromptCacheSource, PromptCacheTimeline};
use super::outcome::{AGENT_RESUME_SOURCE, break_causes, classify, prefix_changes, summarize};
use super::parse_timestamp;
use super::state::{Checkpoint, ModelExpiry, Resume, WindowDraft};
use crate::models::event_types::{ModelCacheState, SessionEventType};
use crate::parsing::events::{TypedEvent, TypedEventData};

/// Tolerance before an expiry that precedes its own checkpoint is taken to
/// contradict the reported TTL.
const TTL_EVIDENCE_SLACK_SECONDS: i64 = 60;

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
                set_model(&mut self.current_model, &data.selected_model);
                set_if_some(&mut self.current_effort, &data.reasoning_effort);
            }
            TypedEventData::SessionResume(data) => {
                set_model(&mut self.current_model, &data.selected_model);
                set_if_some(&mut self.current_effort, &data.reasoning_effort);
            }
            TypedEventData::ModelChange(data) if is_main => {
                set_model(&mut self.current_model, &data.new_model);
                set_if_some(&mut self.current_effort, &data.reasoning_effort);
            }
            TypedEventData::SessionAutoModeResolved(data) if is_main => {
                set_model(&mut self.current_model, &data.chosen_model);
            }
            TypedEventData::TurnStart(data) if is_main => {
                set_model(&mut self.current_model, &data.model);
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
                    self.record_checkpoint(
                        at,
                        Some(data.total_nano_aiu),
                        data.model_cache_state.as_deref().unwrap_or(&[]),
                        data.prompt_cache_break_state.as_deref().unwrap_or(&[]),
                    );
                }
            }
            TypedEventData::Other(value)
                if event.event_type == SessionEventType::SessionUsageCheckpoint =>
            {
                // The typed parse failed (schema drift). Read what we can.
                if let Some(at) = timestamp {
                    let lenient = lenient_checkpoint(value);
                    self.malformed += lenient.malformed;
                    self.record_checkpoint(
                        at,
                        lenient.total_nano_aiu,
                        &lenient.states,
                        lenient.break_state,
                    );
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

    fn record_checkpoint(
        &mut self,
        at: DateTime<Utc>,
        total_nano_aiu: Option<u64>,
        states: &[ModelCacheState],
        break_state: &[Value],
    ) {
        let mut expiries = HashMap::new();
        for state in states {
            let Some(model) = state.model_id.clone().filter(|m| !m.is_empty()) else {
                self.malformed += 1;
                continue;
            };
            let expires_at = state.cache_expires_at.as_deref().and_then(parse_timestamp);
            // An expiry well before its own checkpoint contradicts the TTL
            // (seen for a model the session had stopped using), so it is not
            // evidence for the registry.
            let contradicts_ttl = expires_at.is_some_and(|expires| {
                expires < at - Duration::seconds(TTL_EVIDENCE_SLACK_SECONDS)
            });
            if let Some(ttl) = state.cache_ttl_seconds
                && !contradicts_ttl
            {
                *self.observed_ttls.entry((model.clone(), ttl)).or_default() += 1;
            }
            expiries.insert(
                model,
                ModelExpiry {
                    expires_at,
                    ttl_seconds: state.cache_ttl_seconds,
                },
            );
        }

        let parsed = parse_baselines(break_state);
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
            total_nano_aiu,
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
        let resume = self.resume_at(
            event_index,
            at,
            interaction_id,
            Some(AGENT_RESUME_SOURCE.into()),
        );
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
        let resume_baseline = next.and_then(|c| c.active_baseline(model.as_deref()));
        let changes = break_causes(
            classification.outcome,
            prefix_changes(draft, start_baseline, next),
            start_baseline,
            resume_baseline,
        );

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
                .and_then(|(s, n)| Some(n.total_nano_aiu?.saturating_sub(s.total_nano_aiu?))),
            prefix_changes: changes,
        }
    }
}

/// A checkpoint read field by field after its typed parse failed.
struct LenientCheckpoint<'a> {
    total_nano_aiu: Option<u64>,
    states: Vec<ModelCacheState>,
    break_state: &'a [Value],
    malformed: usize,
}

/// Parse a checkpoint whose typed deserialization failed (schema drift),
/// keeping every field that is still readable.
fn lenient_checkpoint(value: &Value) -> LenientCheckpoint<'_> {
    let mut malformed = 0;
    let states = value
        .get("modelCacheState")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let Some(model_id) = entry.get("modelId").and_then(Value::as_str) else {
                malformed += 1;
                return None;
            };
            Some(ModelCacheState {
                model_id: Some(model_id.to_string()),
                cache_expires_at: entry
                    .get("cacheExpiresAt")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                cache_ttl_seconds: entry.get("cacheTtlSeconds").and_then(lenient_u64),
                extra: serde_json::Map::new(),
            })
        })
        .collect();
    LenientCheckpoint {
        total_nano_aiu: value.get("totalNanoAiu").and_then(lenient_u64),
        states,
        break_state: value
            .get("promptCacheBreakState")
            .and_then(Value::as_array)
            .map_or(&[], Vec::as_slice),
        malformed,
    }
}

/// A non-negative integer, also accepting floats and numeric strings.
fn lenient_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_f64().filter(|f| *f >= 0.0).map(|f| f as u64))
        .or_else(|| value.as_str()?.trim().parse().ok())
}

/// `auto` is Copilot's model picker, not a model; `session.auto_mode_resolved`
/// names the model it chose.
const AUTO_MODEL: &str = "auto";

fn set_model(target: &mut Option<String>, value: &Option<String>) {
    if value
        .as_deref()
        .is_some_and(|model| !model.eq_ignore_ascii_case(AUTO_MODEL))
    {
        set_if_some(target, value);
    }
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
