//! Messages delivered to subagents. Since Copilot CLI 1.0.78 every prompt a
//! subagent receives is persisted as a `user.message` scoped by `agentId`, with
//! `source: "agent-<sender id>"`: the launch prompt, follow-ups sent with
//! `write_agent`, and messages from sibling agents. They never open or close a
//! main conversation turn; they attach to the recipient's launching turn.

use super::TurnReconstructor;
use crate::models::conversation::AgentMessage;
use crate::models::event_types::UserMessageData;
use crate::parsing::events::TypedEvent;

impl TurnReconstructor {
    pub(super) fn handle_agent_inbound_message(
        &mut self,
        event: &TypedEvent,
        event_index: usize,
        data: &UserMessageData,
    ) {
        let Some(recipient) = self
            .event_owner(event)
            .filter(|owner| self.tool_call_index.contains_key(owner))
        else {
            return;
        };
        let Some(content) = data.content.as_deref().filter(|c| !c.trim().is_empty()) else {
            return;
        };
        // Skill context injected into a subagent is not a message from an agent.
        if content.trim_start().starts_with("<skill-context") {
            return;
        }
        let sender_agent_id = data
            .source
            .as_deref()
            .and_then(|source| source.strip_prefix("agent-"))
            .map(str::to_string);
        let sender_tool_call_id = sender_agent_id
            .as_deref()
            .and_then(|id| self.agent_owners.get(id))
            .filter(|owner| **owner != recipient)
            .cloned();
        let is_launch = self.messaged_agents.insert(recipient.clone());
        let message = AgentMessage {
            content: content.to_string(),
            recipient_tool_call_id: recipient,
            sender_agent_id,
            sender_tool_call_id,
            delivery: data.delivery.clone(),
            is_launch,
            message_id: data.message_id.clone(),
            timestamp: event.raw.timestamp,
            event_index: Some(event_index),
        };
        let (turn, _) = self.turn_for_event(event);
        turn.agent_messages.push(message);
    }
}
