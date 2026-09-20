//! Build [`SkillInvocation`]s from reconstructed turns plus one event pass.

use std::collections::{HashMap, HashSet};

use crate::agent_runs::AgentRun;
use crate::models::conversation::ConversationTurn;
use crate::parsing::events::{TypedEvent, TypedEventData};
use crate::tokens::{content_fingerprint, estimate_skill_token_usage};

use super::model::{
    SkillInvocation, SkillInvocationOrigin, normalize_skill_directory, normalize_skill_name,
};

/// Where the reconstructor placed one `skill.invoked` event.
struct Placement {
    turn_index: usize,
    tool_call_id: Option<String>,
    /// The model recorded on the tool call that loaded the skill.
    model: Option<String>,
}

/// Index the reconstructed turns so each event id can be resolved back to its
/// turn without re-deriving turn boundaries.
///
/// The reconstructor attaches a skill invocation either to the `skill` tool
/// call that loaded it or, when it could not correlate one, to the turn's
/// session events. Both are walked so every event is placed.
fn placements(turns: &[ConversationTurn]) -> HashMap<&str, Placement> {
    let mut map = HashMap::new();
    for turn in turns {
        for call in &turn.tool_calls {
            let Some(invocation) = call.skill_invocation.as_ref() else {
                continue;
            };
            let Some(id) = invocation.id.as_deref() else {
                continue;
            };
            map.insert(
                id,
                Placement {
                    turn_index: turn.turn_index,
                    tool_call_id: call.tool_call_id.clone(),
                    model: call.model.clone().or_else(|| turn.model.clone()),
                },
            );
        }
        for event in &turn.session_events {
            let Some(id) = event
                .skill_invocation
                .as_ref()
                .and_then(|invocation| invocation.id.as_deref())
            else {
                continue;
            };
            map.insert(
                id,
                Placement {
                    turn_index: turn.turn_index,
                    tool_call_id: None,
                    model: turn.model.clone(),
                },
            );
        }
    }
    map
}

/// Runtime agent id → the agent's name, so an invocation can say which
/// subagent made it rather than just that one did.
fn agent_names(runs: &[AgentRun]) -> HashMap<&str, &str> {
    runs.iter()
        .filter_map(|run| Some((run.agent_id.as_deref()?, run.agent_name.as_str())))
        .collect()
}

fn non_empty(value: Option<&String>) -> Option<String> {
    value
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Extract every skill invocation in one session.
///
/// `turns` must be the output of [`crate::turns::reconstruct_turns`] for the
/// same `events` so turn indexes match the Conversation tab, and `agent_runs`
/// the output of [`crate::agent_runs::extract_agent_runs`] for the same pair.
pub fn extract_skill_invocations(
    events: &[TypedEvent],
    turns: &[ConversationTurn],
    agent_runs: &[AgentRun],
) -> Vec<SkillInvocation> {
    let placements = placements(turns);
    let agents = agent_names(agent_runs);

    let mut invocations: Vec<SkillInvocation> = Vec::new();
    // What the event pass already accounts for, so the fallback pass never
    // counts the same invocation twice: the tool call it was correlated to,
    // and — when the CLI recorded no correlation — the skill's name within
    // the turn it happened in.
    let mut covered = Covered::default();

    for (event_index, event) in events.iter().enumerate() {
        let TypedEventData::SkillInvoked(data) = &event.typed_data else {
            continue;
        };
        let Some(name) = non_empty(data.name.as_ref()) else {
            continue;
        };
        let placement = event.raw.id.as_deref().and_then(|id| placements.get(id));
        let normalized_name = normalize_skill_name(&name);
        let turn_index = placement.map(|p| p.turn_index).unwrap_or(0);
        if let Some(tool_call_id) = placement.and_then(|p| p.tool_call_id.as_deref()) {
            covered.tool_calls.insert(tool_call_id.to_string());
        } else {
            *covered
                .uncorrelated
                .entry((
                    turn_index,
                    normalized_name.clone(),
                    event.raw.agent_id.clone(),
                ))
                .or_default() += 1;
        }
        let path = non_empty(data.path.as_ref());
        let content = data.content.as_deref().filter(|text| !text.is_empty());
        let (frontmatter_tokens, instruction_tokens) = match content {
            Some(content) => {
                let (frontmatter, instructions) = estimate_skill_token_usage(content);
                (Some(frontmatter), Some(instructions))
            }
            None => (None, None),
        };
        let agent_id = event.raw.agent_id.clone();

        invocations.push(SkillInvocation {
            event_index,
            turn_index,
            tool_call_id: placement.and_then(|p| p.tool_call_id.clone()),
            timestamp: event.raw.timestamp,
            normalized_name,
            name,
            normalized_directory: path.as_deref().and_then(normalize_skill_directory),
            path,
            description: non_empty(data.description.as_ref()),
            source: non_empty(data.source.as_ref()),
            trigger: non_empty(data.trigger.as_ref()),
            agent_name: agent_id
                .as_deref()
                .and_then(|id| agents.get(id))
                .map(|name| (*name).to_string()),
            agent_id,
            model: non_empty(data.model.as_ref())
                .or_else(|| placement.and_then(|p| p.model.clone())),
            plugin_name: non_empty(data.plugin_name.as_ref()),
            plugin_version: non_empty(data.plugin_version.as_ref()),
            content_sha256: content.map(content_fingerprint),
            frontmatter_tokens,
            instruction_tokens,
            origin: SkillInvocationOrigin::Event,
        });
    }

    invocations.extend(fallback_invocations(turns, &mut covered, &agents));
    invocations.sort_by_key(|invocation| invocation.event_index);
    invocations
}

#[derive(Default)]
struct Covered {
    tool_calls: HashSet<String>,
    uncorrelated: HashMap<(usize, String, Option<String>), usize>,
}

/// `skill` tool calls with no `skill.invoked` event behind them.
///
/// Older CLI versions record the call without the event; in a real local
/// corpus 6 of 168 skill calls had no event. They carry only the requested
/// name, so they are recorded without a path, hash or token estimate.
fn fallback_invocations(
    turns: &[ConversationTurn],
    covered: &mut Covered,
    agents: &HashMap<&str, &str>,
) -> Vec<SkillInvocation> {
    let mut fallbacks = Vec::new();
    for turn in turns {
        for call in &turn.tool_calls {
            if call.tool_name != "skill" || call.skill_invocation.is_some() {
                continue;
            }
            if let Some(id) = call.tool_call_id.as_deref()
                && covered.tool_calls.contains(id)
            {
                continue;
            }
            let Some(name) = call
                .arguments
                .as_ref()
                .and_then(|arguments| arguments.get("skill"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
            else {
                continue;
            };
            let normalized_name = normalize_skill_name(name);
            // Each uncorrelated event covers at most one call by the same agent.
            // A correlated invocation must not hide a later use of the same skill.
            let key = (
                turn.turn_index,
                normalized_name.clone(),
                call.agent_id.clone(),
            );
            if let Some(remaining) = covered.uncorrelated.get_mut(&key)
                && *remaining > 0
            {
                *remaining -= 1;
                continue;
            }
            // Without an event of its own the tool call's start event is the
            // only place in the stream to link back to.
            let Some(event_index) = call.event_index else {
                continue;
            };
            fallbacks.push(SkillInvocation {
                event_index,
                turn_index: turn.turn_index,
                tool_call_id: call.tool_call_id.clone(),
                timestamp: call.started_at.or(turn.timestamp),
                name: name.to_string(),
                normalized_name,
                path: None,
                normalized_directory: None,
                description: None,
                source: None,
                trigger: None,
                agent_id: call.agent_id.clone(),
                agent_name: call
                    .agent_id
                    .as_deref()
                    .and_then(|id| agents.get(id))
                    .map(|name| (*name).to_string()),
                model: call.model.clone().or_else(|| turn.model.clone()),
                plugin_name: None,
                plugin_version: None,
                content_sha256: None,
                frontmatter_tokens: None,
                instruction_tokens: None,
                origin: SkillInvocationOrigin::ToolCallFallback,
            });
        }
    }
    fallbacks
}
