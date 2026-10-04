//! Reasoning effort usage per user turn.
//!
//! A user turn is every agent turn that serves one user message (see
//! [`crate::turns::user_turn_indices`]). Comparing efforts per user turn
//! rather than per request shows what an effort level costs to answer a
//! request: higher effort tends to take more requests, not only longer ones.
//!
//! Events alone give each user turn's effort, model, agent turns (one model
//! request each), main-agent tool calls and wall time. When Copilot CLI's
//! session store recorded the session's requests
//! ([`crate::session_store`]), each request is attributed to a user turn too,
//! adding reasoning tokens, API time and AI Credits. Subagent requests count
//! separately because they run at their own effort.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::conversation::ConversationTurn;
use crate::session_store::RequestUsage;
use crate::turns::user_turn_indices;

/// User turns that ran on one model at one reasoning effort.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffortUsageEntry {
    pub model: Option<String>,
    /// `None` when the model's default effort applied.
    pub reasoning_effort: Option<String>,
    /// Sessions contributing (cross-session aggregates only).
    #[serde(default)]
    pub sessions: u32,
    pub user_turns: u32,
    /// Main-agent agent turns; each is one model request.
    pub agent_turns: u32,
    /// Main-agent tool calls.
    pub tool_calls: u32,
    /// Summed wall time from each user turn's first agent turn to its end.
    pub wall_ms: u64,
    /// User turns with recorded requests; the fields below cover only these.
    pub observed_user_turns: u32,
    /// Main-agent requests recorded by the session store.
    pub requests: u32,
    pub reasoning_tokens: u64,
    pub output_tokens: u64,
    pub api_duration_ms: u64,
    pub nano_aiu: u64,
    pub subagent_requests: u32,
    pub subagent_nano_aiu: u64,
}

impl EffortUsageEntry {
    /// Add another entry's totals into this one.
    pub fn absorb(&mut self, other: &EffortUsageEntry) {
        self.sessions += other.sessions;
        self.user_turns += other.user_turns;
        self.agent_turns += other.agent_turns;
        self.tool_calls += other.tool_calls;
        self.wall_ms += other.wall_ms;
        self.observed_user_turns += other.observed_user_turns;
        self.requests += other.requests;
        self.reasoning_tokens += other.reasoning_tokens;
        self.output_tokens += other.output_tokens;
        self.api_duration_ms += other.api_duration_ms;
        self.nano_aiu += other.nano_aiu;
        self.subagent_requests += other.subagent_requests;
        self.subagent_nano_aiu += other.subagent_nano_aiu;
    }
}

/// A session's user turns grouped by model and effort.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEffortUsage {
    /// Most user turns first.
    pub entries: Vec<EffortUsageEntry>,
    /// Whether the session store recorded any of this session's requests.
    pub has_request_data: bool,
}

#[derive(Default)]
struct UserTurn {
    events_model: Option<String>,
    events_effort: Option<String>,
    agent_turns: u32,
    tool_calls: u32,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    observed: bool,
    store_model: Option<String>,
    store_effort: Option<String>,
    requests: u32,
    reasoning_tokens: u64,
    output_tokens: u64,
    api_duration_ms: u64,
    nano_aiu: u64,
    subagent_requests: u32,
    subagent_nano_aiu: u64,
}

/// Group a session's user turns by model and reasoning effort.
///
/// `requests` are the session store's rows for this session, oldest first.
/// The main agent's requests are attributed by time to the agent turn that
/// was running; a subagent's by its launching tool call. Compaction requests
/// are left out: they summarise context and do not depend on effort.
pub fn build_effort_usage(
    turns: &[ConversationTurn],
    requests: Option<&[RequestUsage]>,
) -> SessionEffortUsage {
    let indices = user_turn_indices(turns);
    let count = indices.iter().max().map_or(0, |max| max + 1);
    let mut user_turns: Vec<UserTurn> = (0..count).map(|_| UserTurn::default()).collect();
    let mut owner_of_tool_call: HashMap<&str, usize> = HashMap::new();
    let mut starts: Vec<(DateTime<Utc>, usize)> = Vec::new();
    let mut previous: Option<(Option<&str>, bool)> = None;

    for (turn, &index) in turns.iter().zip(&indices) {
        let user_turn = &mut user_turns[index];
        if user_turn.events_model.is_none() {
            user_turn.events_model = turn.model.clone();
        }
        if user_turn.agent_turns == 0 {
            user_turn.events_effort = turn.reasoning_effort.clone();
        }
        // A message Copilot injects mid-turn ends the conversation turn early
        // and opens another with the same `turnId`: one agent turn, counted
        // once. (Turn IDs restart with every run, so only adjacency counts.)
        let continues_split = previous.is_some_and(|(id, complete)| {
            !complete && id.is_some() && id == turn.turn_id.as_deref()
        });
        let ran = turn.turn_id.is_some()
            || turn.is_complete
            || !turn.assistant_messages.is_empty()
            || !turn.tool_calls.is_empty();
        if ran && !continues_split {
            user_turn.agent_turns += 1;
        }
        previous = Some((turn.turn_id.as_deref(), turn.is_complete));
        for tool_call in &turn.tool_calls {
            if tool_call.parent_tool_call_id.is_none() {
                user_turn.tool_calls += 1;
            }
            if let Some(id) = tool_call.tool_call_id.as_deref() {
                owner_of_tool_call.insert(id, index);
            }
        }
        if let Some(start) = turn.timestamp {
            user_turn.start = Some(user_turn.start.map_or(start, |s| s.min(start)));
            starts.push((start, index));
        }
        if let Some(end) = turn.end_timestamp.or(turn.timestamp) {
            user_turn.end = Some(user_turn.end.map_or(end, |e| e.max(end)));
        }
    }
    starts.sort_by_key(|(start, _)| *start);

    let rows = requests.unwrap_or_default();
    for row in rows.iter().filter(|row| !row.is_compaction()) {
        let by_owner = row
            .parent_tool_call_id
            .as_deref()
            .and_then(|id| owner_of_tool_call.get(id).copied());
        let Some(index) = by_owner.or_else(|| running_at(&starts, row.created_at)) else {
            continue;
        };
        let user_turn = &mut user_turns[index];
        user_turn.observed = true;
        if row.is_subagent() {
            user_turn.subagent_requests += 1;
            user_turn.subagent_nano_aiu += row.nano_aiu;
            continue;
        }
        if user_turn.requests == 0 {
            user_turn.store_model = Some(row.model.clone());
            user_turn.store_effort = row.reasoning_effort.clone();
        }
        user_turn.requests += 1;
        user_turn.reasoning_tokens += row.reasoning_tokens;
        user_turn.output_tokens += row.output_tokens;
        user_turn.api_duration_ms += row.duration_ms;
        user_turn.nano_aiu += row.nano_aiu;
    }

    let mut entries: Vec<EffortUsageEntry> = Vec::new();
    for user_turn in user_turns {
        if user_turn.agent_turns == 0 && !user_turn.observed {
            continue;
        }
        // A recorded request names the model and effort it was sent with,
        // including the effort auto mode picked, which events do not record.
        let (model, effort) = if user_turn.requests > 0 {
            (user_turn.store_model, user_turn.store_effort)
        } else {
            (user_turn.events_model, user_turn.events_effort)
        };
        let wall_ms = match (user_turn.start, user_turn.end) {
            (Some(start), Some(end)) => end.signed_duration_since(start).num_milliseconds().max(0),
            _ => 0,
        } as u64;
        let entry = EffortUsageEntry {
            model,
            reasoning_effort: effort,
            sessions: 0,
            user_turns: 1,
            agent_turns: user_turn.agent_turns,
            tool_calls: user_turn.tool_calls,
            wall_ms,
            observed_user_turns: u32::from(user_turn.observed),
            requests: user_turn.requests,
            reasoning_tokens: user_turn.reasoning_tokens,
            output_tokens: user_turn.output_tokens,
            api_duration_ms: user_turn.api_duration_ms,
            nano_aiu: user_turn.nano_aiu,
            subagent_requests: user_turn.subagent_requests,
            subagent_nano_aiu: user_turn.subagent_nano_aiu,
        };
        match entries
            .iter_mut()
            .find(|e| e.model == entry.model && e.reasoning_effort == entry.reasoning_effort)
        {
            Some(existing) => existing.absorb(&entry),
            None => entries.push(entry),
        }
    }
    entries.sort_by(|a, b| b.user_turns.cmp(&a.user_turns));

    SessionEffortUsage {
        entries,
        has_request_data: !rows.is_empty(),
    }
}

/// The user turn whose agent turn was running at `at`: the last one that
/// started at or before it. A request logged before the first turn belongs
/// to the first.
fn running_at(starts: &[(DateTime<Utc>, usize)], at: Option<DateTime<Utc>>) -> Option<usize> {
    let at = at?;
    let after = starts.partition_point(|(start, _)| *start <= at);
    starts.get(after.saturating_sub(1)).map(|(_, index)| *index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::conversation::TurnToolCall;
    use crate::turns::new_turn;

    fn ts(second: u32) -> Option<DateTime<Utc>> {
        Some(
            DateTime::parse_from_rfc3339(&format!("2026-10-04T08:10:{second:02}Z"))
                .unwrap()
                .with_timezone(&Utc),
        )
    }

    fn turn(start: u32, end: u32, user: Option<&str>, effort: &str) -> ConversationTurn {
        let mut turn = new_turn(0, ts(start), None, user.map(str::to_string), None, None);
        turn.end_timestamp = ts(end);
        turn.turn_id = Some(format!("t{start}"));
        turn.model = Some("gpt-5.6-luna".into());
        turn.reasoning_effort = Some(effort.into());
        turn
    }

    fn request(at: u32, effort: &str, reasoning: u64, parent: Option<&str>) -> RequestUsage {
        RequestUsage {
            created_at: ts(at),
            model: "gpt-5.6-luna".into(),
            reasoning_effort: Some(effort.into()),
            initiator: Some(
                if parent.is_some() {
                    "sub-agent"
                } else {
                    "agent"
                }
                .into(),
            ),
            parent_tool_call_id: parent.map(str::to_string),
            output_tokens: reasoning * 2,
            reasoning_tokens: reasoning,
            duration_ms: 1_000,
            nano_aiu: 1_000_000,
            ..RequestUsage::default()
        }
    }

    #[test]
    fn events_only_groups_user_turns_by_effort() {
        let turns = vec![
            turn(0, 5, Some("a"), "medium"),
            turn(5, 9, None, "medium"),
            turn(10, 20, Some("b"), "xhigh"),
        ];
        let usage = build_effort_usage(&turns, None);
        assert!(!usage.has_request_data);
        let medium = usage
            .entries
            .iter()
            .find(|e| e.reasoning_effort.as_deref() == Some("medium"))
            .unwrap();
        assert_eq!(
            (medium.user_turns, medium.agent_turns, medium.wall_ms),
            (1, 2, 9_000)
        );
        assert_eq!(medium.observed_user_turns, 0);
    }

    #[test]
    fn requests_attribute_by_time_and_subagents_by_launch() {
        let mut launch = turn(0, 5, Some("a"), "high");
        let task: TurnToolCall = serde_json::from_value(serde_json::json!({
            "toolCallId": "call-1", "toolName": "task", "isComplete": true,
        }))
        .unwrap();
        launch.tool_calls.push(task);
        let turns = vec![
            launch,
            turn(5, 9, None, "high"),
            turn(10, 20, Some("b"), "high"),
        ];
        let requests = vec![
            request(2, "high", 100, None),
            request(6, "high", 50, None),
            // A subagent's request lands during the next user turn but
            // belongs to the turn that launched it.
            request(12, "low", 999, Some("call-1")),
            request(15, "high", 10, None),
            RequestUsage {
                initiator: Some("compaction".into()),
                ..request(16, "high", 5_000, None)
            },
        ];
        let usage = build_effort_usage(&turns, Some(&requests));
        assert!(usage.has_request_data);
        assert_eq!(usage.entries.len(), 1);
        let high = &usage.entries[0];
        assert_eq!(high.user_turns, 2);
        assert_eq!(high.observed_user_turns, 2);
        assert_eq!(high.requests, 3);
        assert_eq!(high.reasoning_tokens, 160);
        assert_eq!(high.subagent_requests, 1);
    }

    #[test]
    fn recorded_effort_wins_when_events_name_none() {
        // Auto mode: events record no effort, the request records the one sent.
        let mut auto = turn(0, 5, Some("a"), "unused");
        auto.reasoning_effort = None;
        let usage = build_effort_usage(&[auto], Some(&[request(1, "high", 10, None)]));
        assert_eq!(usage.entries[0].reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn a_turn_split_by_an_injected_message_counts_once() {
        // Turn IDs restart with each run, so a repeated ID after a finished
        // turn is a new agent turn; only an unfinished one was split.
        let mut split = turn(0, 2, Some("a"), "high");
        split.turn_id = Some("0".into());
        let mut rest = turn(2, 4, None, "high");
        rest.turn_id = Some("0".into());
        rest.is_complete = true;
        let mut next_run = turn(5, 6, None, "high");
        next_run.turn_id = Some("0".into());
        let usage = build_effort_usage(&[split, rest, next_run], None);
        assert_eq!(usage.entries[0].agent_turns, 2);
    }
}
