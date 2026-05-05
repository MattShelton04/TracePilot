use crate::models::event_types::SessionEventType;
use crate::parsing::events::{TypedEvent, TypedEventData};

/// High-level event builder that produces TypedEvent instances.
#[must_use = "builders do nothing unless consumed"]
pub struct EventBuilder {
    event_type: SessionEventType,
    typed_data: TypedEventData,
    id: String,
    timestamp: String,
    parent_id: Option<String>,
}

impl EventBuilder {
    pub(super) fn new(event_type: SessionEventType, typed_data: TypedEventData) -> Self {
        Self {
            event_type,
            typed_data,
            id: "evt".to_string(),
            timestamp: "2026-03-10T07:00:00.000Z".to_string(),
            parent_id: None,
        }
    }

    pub fn id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    pub fn timestamp(mut self, ts: impl Into<String>) -> Self {
        self.timestamp = ts.into();
        self
    }

    pub fn parent(mut self, parent_id: impl Into<String>) -> Self {
        self.parent_id = Some(parent_id.into());
        self
    }

    pub fn build_event(self) -> TypedEvent {
        super::super::make_event(
            self.event_type,
            self.typed_data,
            &self.id,
            &self.timestamp,
            self.parent_id.as_deref(),
        )
    }
}
