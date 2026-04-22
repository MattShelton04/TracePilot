//! Message-level event handlers (user, assistant, reasoning, system, turn boundaries).

use crate::models::conversation::AttributedMessage;
use crate::models::event_types::{
    AssistantMessageData, AssistantReasoningData, SystemMessageData, TurnEndData, TurnStartData,
    UserMessageData,
};
use crate::parsing::events::TypedEvent;

use super::TurnReconstructor;
use super::state::new_turn;

impl TurnReconstructor {
    pub(super) fn handle_user_message(
        &mut self,
        event: &TypedEvent,
        event_index: usize,
        data: &UserMessageData,
    ) {
        self.finalize_current_turn(false, None);
        let mut turn = new_turn(
            self.turns.len(),
            event.raw.timestamp,
            data.interaction_id.clone(),
            data.content.clone(),
            data.transformed_content.clone(),
            data.attachments.clone(),
        );
        turn.event_index = Some(event_index);
        turn.model = self.session_model.clone();
        // Flush any session events that occurred between turns
        turn.session_events.append(&mut self.pending_session_events);
        // Flush any system messages that arrived before this turn
        turn.system_messages
            .append(&mut self.pending_system_messages);
        self.current_turn = Some(turn);
    }

    pub(super) fn handle_assistant_turn_start(&mut self, event: &TypedEvent, data: &TurnStartData) {
        let turn = self.ensure_current_turn(event.raw.timestamp);
        if turn.turn_id.is_none() {
            turn.turn_id = data.turn_id.clone();
        }
        if turn.interaction_id.is_none() {
            turn.interaction_id = data.interaction_id.clone();
        }
    }

    pub(super) fn handle_assistant_message(
        &mut self,
        event: &TypedEvent,
        data: &AssistantMessageData,
    ) {
        let turn = self.ensure_current_turn(event.raw.timestamp);
        if turn.interaction_id.is_none() {
            turn.interaction_id = data.interaction_id.clone();
        }
        if let Some(content) = &data.content
            && !content.trim().is_empty()
        {
            turn.assistant_messages.push(AttributedMessage {
                content: content.clone(),
                parent_tool_call_id: data.parent_tool_call_id.clone(),
                agent_display_name: None, // resolved in finalize()
            });
        }
        if let Some(reasoning) = &data.reasoning_text
            && !reasoning.trim().is_empty()
        {
            turn.reasoning_texts.push(AttributedMessage {
                content: reasoning.clone(),
                parent_tool_call_id: data.parent_tool_call_id.clone(),
                agent_display_name: None, // resolved in finalize()
            });
        }
        if let Some(tokens) = data.output_tokens {
            *turn.output_tokens.get_or_insert(0) += tokens;
        }
        if let Some(requests) = &data.tool_requests {
            for req in requests {
                if let (Some(id), Some(summary)) = (
                    req.get("toolCallId").and_then(|v| v.as_str()),
                    req.get("intentionSummary").and_then(|v| v.as_str()),
                ) && !summary.trim().is_empty()
                {
                    self.tool_call_intentions
                        .insert(id.to_string(), summary.to_string());
                }
            }
        }
    }

    pub(super) fn handle_assistant_turn_end(&mut self, event: &TypedEvent, data: &TurnEndData) {
        if let Some(turn) = self.current_turn.as_mut()
            && turn.turn_id.is_none()
        {
            turn.turn_id = data.turn_id.clone();
        }
        self.finalize_current_turn(true, event.raw.timestamp);
    }

    pub(super) fn handle_assistant_reasoning(
        &mut self,
        event: &TypedEvent,
        data: &AssistantReasoningData,
    ) {
        if let Some(content) = &data.content
            && !content.trim().is_empty()
        {
            let turn = self.ensure_current_turn(event.raw.timestamp);
            turn.reasoning_texts.push(AttributedMessage {
                content: content.clone(),
                parent_tool_call_id: None,
                agent_display_name: None,
            });
        }
    }

    pub(super) fn handle_system_message(&mut self, event: &TypedEvent, data: &SystemMessageData) {
        if let Some(content) = &data.content
            && !content.trim().is_empty()
        {
            let content = content.clone();
            if let Some(turn) = &mut self.current_turn {
                turn.system_messages.push(content);
            } else {
                self.pending_system_messages_ts =
                    self.pending_system_messages_ts.or(event.raw.timestamp);
                self.pending_system_messages.push(content);
            }
        }
    }
}
