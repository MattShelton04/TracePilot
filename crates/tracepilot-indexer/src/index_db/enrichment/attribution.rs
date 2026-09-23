//! Attaching recorded requests to TracePilot's own run and event structure.
//!
//! Two joins are attempted, both on identifiers or exact counters:
//!
//! 1. **Agent linkage.** Every locally inspected subagent request carried an
//!    agent ID and a parent tool-call ID, and all of them matched a persisted
//!    `tool.execution_start`, so exact linkage covers the case that matters.
//! 2. **Compaction.** A request the source marks `initiator=compaction`
//!    matches a `session.compaction_complete` event whose recorded token
//!    usage is identical — the same evidence that explained the 112-vs-111
//!    reconciliation discrepancy in the research.
//!
//! Turn attribution is deliberately absent. 85 of 383 local usage rows have
//! no matching source turn at all, and an exact-text comparison between
//! stored turns and root user events produced several different index
//! offsets, so a constant `+1` is unsafe. A request with no join stays in the
//! ledger, visible and unattributed — a more useful answer than a confident
//! wrong one.

use std::collections::HashMap;

use tracepilot_core::models::event_types::model_data::CompactionCompleteData;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::session_store::{AttributionStatus, StoreRequest};

use crate::Result;

use super::super::IndexDb;
use super::types::{JoinMethod, RequestLinkRow};

/// An indexed agent run, reduced to what a join needs.
struct RunCandidate {
    run_key: String,
    agent_id: Option<String>,
    tool_call_id: Option<String>,
    turn_index: Option<i64>,
    event_index: Option<i64>,
}

/// A compaction event and where it sits in the stream.
struct CompactionCandidate<'a> {
    data: &'a CompactionCompleteData,
    event_index: i64,
}

impl IndexDb {
    /// Build links for one session's requests.
    ///
    /// `events` may be empty when the log was not parsed — the agent join
    /// still works from indexed runs, and compaction requests simply stay
    /// unjoined rather than being matched on timing alone.
    ///
    /// `event_fingerprint` identifies the snapshot these mappings came from,
    /// so a later log rewrite invalidates them instead of leaving stale
    /// targets attached to requests.
    pub(crate) fn build_request_links(
        &self,
        session_id: &str,
        requests: &[StoreRequest],
        events: &[TypedEvent],
        event_fingerprint: Option<String>,
    ) -> Result<Vec<RequestLinkRow>> {
        let runs = self.load_run_candidates(session_id)?;
        let by_agent = index_by(&runs, |run| run.agent_id.as_deref());
        let by_tool_call = index_by(&runs, |run| run.tool_call_id.as_deref());
        let compactions = collect_compactions(events);

        Ok(requests
            .iter()
            .map(|request| {
                let context = JoinContext {
                    session_id,
                    runs: &runs,
                    by_agent: &by_agent,
                    by_tool_call: &by_tool_call,
                    compactions: &compactions,
                    event_fingerprint: event_fingerprint.clone(),
                };
                link_for(request, &context)
            })
            .collect())
    }

    fn load_run_candidates(&self, session_id: &str) -> Result<Vec<RunCandidate>> {
        let mut stmt = self.conn.prepare(
            "SELECT run_key, agent_id, tool_call_id, turn_index, event_index \
             FROM session_agent_runs WHERE session_id = ?1",
        )?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok(RunCandidate {
                    run_key: row.get(0)?,
                    agent_id: row.get(1)?,
                    tool_call_id: row.get(2)?,
                    turn_index: row.get(3)?,
                    event_index: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
}

struct JoinContext<'a> {
    session_id: &'a str,
    runs: &'a [RunCandidate],
    by_agent: &'a HashMap<&'a str, Vec<usize>>,
    by_tool_call: &'a HashMap<&'a str, Vec<usize>>,
    compactions: &'a [CompactionCandidate<'a>],
    event_fingerprint: Option<String>,
}

/// Map a key to the run indices that carry it. A key claimed by more than one
/// run is ambiguous, and the count is what detects that.
fn index_by<'a>(
    runs: &'a [RunCandidate],
    key: impl Fn(&'a RunCandidate) -> Option<&'a str>,
) -> HashMap<&'a str, Vec<usize>> {
    let mut index: HashMap<&str, Vec<usize>> = HashMap::new();
    for (position, run) in runs.iter().enumerate() {
        if let Some(value) = key(run) {
            index.entry(value).or_default().push(position);
        }
    }
    index
}

fn collect_compactions(events: &[TypedEvent]) -> Vec<CompactionCandidate<'_>> {
    events
        .iter()
        .enumerate()
        .filter_map(|(event_index, event)| match &event.typed_data {
            TypedEventData::CompactionComplete(data) => Some(CompactionCandidate {
                data,
                event_index: i64::try_from(event_index).unwrap_or(i64::MAX),
            }),
            _ => None,
        })
        .collect()
}

fn link_for(request: &StoreRequest, context: &JoinContext<'_>) -> RequestLinkRow {
    let unlinked = |method: JoinMethod, status: AttributionStatus| RequestLinkRow {
        source_row_id: request.source_row_id,
        session_id: context.session_id.to_string(),
        run_key: None,
        turn_index: None,
        event_index: None,
        join_method: method.as_str(),
        join_status: status,
        event_fingerprint: context.event_fingerprint.clone(),
    };

    if request
        .initiator
        .as_ref()
        .is_some_and(|initiator| initiator.is_compaction())
    {
        return match unique_compaction(request, context.compactions) {
            Some(event_index) => RequestLinkRow {
                source_row_id: request.source_row_id,
                session_id: context.session_id.to_string(),
                run_key: None,
                turn_index: None,
                event_index: Some(event_index),
                join_method: JoinMethod::CompactionEvent.as_str(),
                join_status: AttributionStatus::Exact,
                event_fingerprint: context.event_fingerprint.clone(),
            },
            None => unlinked(JoinMethod::CompactionEvent, AttributionStatus::Unavailable),
        };
    }

    let agent_match = request
        .agent_id
        .as_deref()
        .and_then(|agent_id| unique(context.by_agent.get(agent_id)));
    // The parent tool-call field is deprecated in the CLI's current schema.
    // Its absence must not invalidate an otherwise valid agent-ID join, so it
    // only ever corroborates or contradicts.
    let tool_match = request
        .parent_tool_call_id
        .as_deref()
        .and_then(|tool_call_id| unique(context.by_tool_call.get(tool_call_id)));

    let (position, method) = match (agent_match, tool_match) {
        (Some(agent), Some(tool)) if agent != tool => {
            // Two identifiers naming different runs is a contradiction, not a
            // reason to prefer one. Leave it visibly ambiguous.
            return unlinked(JoinMethod::AgentId, AttributionStatus::Ambiguous);
        }
        (Some(agent), _) => (agent, JoinMethod::AgentId),
        (None, Some(tool)) => (tool, JoinMethod::ParentToolCall),
        (None, None) => {
            // An ID that matched several runs is ambiguous; no ID at all is
            // simply unavailable, and a root request with no agent is the
            // ordinary case rather than a failure.
            let claimed_but_not_unique = request
                .agent_id
                .as_deref()
                .is_some_and(|agent_id| context.by_agent.contains_key(agent_id))
                || request
                    .parent_tool_call_id
                    .as_deref()
                    .is_some_and(|id| context.by_tool_call.contains_key(id));
            return unlinked(
                JoinMethod::None,
                if claimed_but_not_unique {
                    AttributionStatus::Ambiguous
                } else {
                    AttributionStatus::Unavailable
                },
            );
        }
    };

    let Some(run) = context.runs.get(position) else {
        return unlinked(JoinMethod::None, AttributionStatus::Unavailable);
    };
    RequestLinkRow {
        source_row_id: request.source_row_id,
        session_id: context.session_id.to_string(),
        run_key: Some(run.run_key.clone()),
        turn_index: run.turn_index,
        event_index: run.event_index,
        join_method: method.as_str(),
        // An identifier both sides recorded is an exact join. Nothing here is
        // inferred from ordering or timing.
        join_status: AttributionStatus::Exact,
        event_fingerprint: context.event_fingerprint.clone(),
    }
}

/// The one compaction event whose recorded usage matches this request.
///
/// Matching is on counters and model, never on time alone: a session can
/// compact more than once, and the source's `created_at` is a recording time
/// rather than a guaranteed request start. Two events that match equally well
/// leave the request unjoined.
fn unique_compaction(
    request: &StoreRequest,
    compactions: &[CompactionCandidate<'_>],
) -> Option<i64> {
    let mut matched: Option<i64> = None;
    for candidate in compactions {
        let Some(usage) = candidate.data.compaction_tokens_used.as_ref() else {
            continue;
        };
        let counters_match = request.input_tokens.is_some()
            && request.output_tokens.is_some()
            && usage.input_tokens == request.input_tokens
            && usage.output_tokens == request.output_tokens
            && usage.cache_read_tokens == request.cache_read_tokens;
        let model_matches = usage
            .model
            .as_deref()
            .is_none_or(|model| model == request.model);
        if !(counters_match && model_matches) {
            continue;
        }
        if matched.is_some() {
            return None;
        }
        matched = Some(candidate.event_index);
    }
    matched
}

/// The single run a key names, or `None` when zero or several do.
fn unique(positions: Option<&Vec<usize>>) -> Option<usize> {
    match positions {
        Some(positions) if positions.len() == 1 => positions.first().copied(),
        _ => None,
    }
}
