use super::reducer;
use super::{SessionLiveState, SessionRuntimeStatus};
use crate::bridge::BridgeEvent;
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Default)]
pub struct LiveStateStore {
    states: RwLock<HashMap<String, SessionLiveState>>,
}

impl LiveStateStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply_event(&self, event: &BridgeEvent) -> SessionLiveState {
        let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
        let state = states
            .entry(event.session_id.clone())
            .or_insert_with(|| SessionLiveState::new(&event.session_id));
        reducer::apply_event(state, event);
        state.clone()
    }

    pub fn mark_status(
        &self,
        session_id: &str,
        status: SessionRuntimeStatus,
        last_error: Option<String>,
    ) -> SessionLiveState {
        let mut states = self.states.write().unwrap_or_else(|e| e.into_inner());
        let state = states
            .entry(session_id.to_string())
            .or_insert_with(|| SessionLiveState::new(session_id));
        state.status = status;
        state.last_error = last_error;
        state.clone()
    }

    pub fn get(&self, session_id: &str) -> Option<SessionLiveState> {
        self.states
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .cloned()
    }

    pub fn list(&self) -> Vec<SessionLiveState> {
        let mut states: Vec<_> = self
            .states
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        states.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        states
    }
}
