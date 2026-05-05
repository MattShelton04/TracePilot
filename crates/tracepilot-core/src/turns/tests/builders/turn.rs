use crate::models::event_types::{SessionEventType, TurnEndData, TurnStartData};
use crate::parsing::events::TypedEventData;

use super::core::EventBuilder;

/// Builder for turn start events.
#[must_use = "builders do nothing unless consumed"]
pub struct TurnStartBuilder {
    turn_id: Option<String>,
    interaction_id: Option<String>,
}

impl TurnStartBuilder {
    fn new() -> Self {
        Self {
            turn_id: None,
            interaction_id: None,
        }
    }

    pub fn turn_id(mut self, id: impl Into<String>) -> Self {
        self.turn_id = Some(id.into());
        self
    }

    pub fn interaction_id(mut self, id: impl Into<String>) -> Self {
        self.interaction_id = Some(id.into());
        self
    }

    fn build_data(self) -> TurnStartData {
        TurnStartData {
            turn_id: self.turn_id,
            interaction_id: self.interaction_id,
        }
    }

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(self.build_data()),
        )
    }
}

/// Builder for turn end events.
#[must_use = "builders do nothing unless consumed"]
pub struct TurnEndBuilder {
    turn_id: Option<String>,
}

impl TurnEndBuilder {
    fn new() -> Self {
        Self { turn_id: None }
    }

    pub fn turn_id(mut self, id: impl Into<String>) -> Self {
        self.turn_id = Some(id.into());
        self
    }

    fn build_data(self) -> TurnEndData {
        TurnEndData {
            turn_id: self.turn_id,
        }
    }

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(self.build_data()),
        )
    }
}

/// Create a turn start builder.
pub fn turn_start() -> TurnStartBuilder {
    TurnStartBuilder::new()
}

/// Create a turn end builder.
pub fn turn_end() -> TurnEndBuilder {
    TurnEndBuilder::new()
}
