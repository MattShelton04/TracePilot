//! Deduplicated skill receipts (Copilot CLI 1.0.86+).
//!
//! A repeated invocation arrives as `skill.invoked_ref` and is shown exactly
//! like an inline `skill.invoked`. The model-visible wrapper now arrives as
//! `skill.context_delivered(_ref)`, parented to the invocation, instead of a
//! synthetic `<skill-context>` user message; it is folded into that
//! invocation the same way.

use crate::models::event_types::SkillInvokedRefData;
use crate::parsing::events::TypedEvent;

use super::TurnReconstructor;

impl TurnReconstructor {
    pub(super) fn handle_skill_invoked_ref(
        &mut self,
        event: &TypedEvent,
        data: &SkillInvokedRefData,
    ) {
        self.handle_skill_invoked(event, &data.as_invoked());
    }

    pub(super) fn handle_skill_context_delivered(
        &mut self,
        event: &TypedEvent,
        context_length: Option<usize>,
    ) {
        let Some(invocation) = event
            .raw
            .parent_id
            .as_deref()
            .and_then(|parent_id| self.pending_skill_invocations.remove(parent_id))
        else {
            return;
        };
        self.mark_skill_context_folded(&invocation, context_length);
    }
}
