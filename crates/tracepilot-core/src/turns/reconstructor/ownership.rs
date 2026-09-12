//! Agent instance IDs are distinct from the tool calls that launched them.

use crate::models::conversation::ConversationTurn;
use crate::parsing::events::{TypedEvent, TypedEventData};

use super::{CURRENT_TURN_SENTINEL, TurnReconstructor};

impl TurnReconstructor {
    /// Seed ownership from a complete file before replaying delayed child logs.
    pub fn with_agent_ownership(events: &[TypedEvent]) -> Self {
        let mut state = Self::new();
        for event in events {
            state.register_agent_owner(event);
        }
        state
    }

    /// Current root turn, shared with consumers such as full-text indexing.
    pub fn active_turn_index(&self) -> Option<usize> {
        self.current_turn.as_ref().map(|turn| turn.turn_index)
    }

    /// Destination of searchable content after process() has handled this event.
    /// Child activity and late tool/lifecycle events retain their launching turn.
    pub fn content_turn_index(&self, event: &TypedEvent) -> Option<usize> {
        let call_id = match &event.typed_data {
            TypedEventData::ToolExecutionStart(d) => d.tool_call_id.as_deref(),
            TypedEventData::ToolExecutionComplete(d) => d.tool_call_id.as_deref(),
            TypedEventData::SubagentStarted(d) => d.tool_call_id.as_deref(),
            _ => None,
        };
        let owner = self.event_owner(event);
        call_id
            .or(owner.as_deref())
            .and_then(|id| self.tool_call_index.get(id))
            .map(|(index, _)| {
                if *index == CURRENT_TURN_SENTINEL {
                    self.turns.len()
                } else {
                    *index
                }
            })
            .or_else(|| self.active_turn_index())
    }

    pub(crate) fn register_agent_owner(&mut self, event: &TypedEvent) {
        let tool_id = match &event.typed_data {
            TypedEventData::SubagentStarted(d) => d.tool_call_id.as_ref(),
            TypedEventData::SubagentCompleted(d) => d.tool_call_id.as_ref(),
            TypedEventData::SubagentFailed(d) => d.tool_call_id.as_ref(),
            TypedEventData::AssistantMessage(d) => d.parent_tool_call_id.as_ref(),
            TypedEventData::ToolExecutionStart(d) => d.parent_tool_call_id.as_ref(),
            TypedEventData::ToolExecutionComplete(d) => d.parent_tool_call_id.as_ref(),
            _ => None,
        };
        if let (Some(agent_id), Some(tool_id)) = (&event.raw.agent_id, tool_id) {
            self.agent_owners.insert(agent_id.clone(), tool_id.clone());
        }
    }

    pub(super) fn resolve_agent_id(&self, agent_id: &str) -> String {
        self.agent_owners
            .get(agent_id)
            .cloned()
            .unwrap_or_else(|| agent_id.to_string())
    }

    pub(super) fn event_owner(&self, event: &TypedEvent) -> Option<String> {
        event
            .raw
            .agent_id
            .as_deref()
            .map(|id| self.resolve_agent_id(id))
    }

    /// Modern subagent activity belongs to the launching turn, even after the
    /// main agent has ended that turn. Legacy events without agentId retain
    /// their chronological grouping and explicit parentToolCallId attribution.
    pub(super) fn turn_for_event(&mut self, event: &TypedEvent) -> (&mut ConversationTurn, usize) {
        if let Some(owner) = self.event_owner(event)
            && let Some(&(turn_idx, _)) = self.tool_call_index.get(&owner)
            && turn_idx != CURRENT_TURN_SENTINEL
        {
            return (&mut self.turns[turn_idx], turn_idx);
        }
        (
            self.ensure_current_turn(event.raw.timestamp),
            CURRENT_TURN_SENTINEL,
        )
    }
}
