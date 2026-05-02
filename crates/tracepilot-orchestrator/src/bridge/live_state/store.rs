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

    /// Helper to acquire the states write lock, handling poisoned mutexes.
    fn states_write(&self) -> std::sync::RwLockWriteGuard<'_, HashMap<String, SessionLiveState>> {
        self.states.write().unwrap_or_else(|e| e.into_inner())
    }

    /// Helper to acquire the states read lock, handling poisoned mutexes.
    fn states_read(&self) -> std::sync::RwLockReadGuard<'_, HashMap<String, SessionLiveState>> {
        self.states.read().unwrap_or_else(|e| e.into_inner())
    }

    pub fn apply_event(&self, event: &BridgeEvent) -> SessionLiveState {
        let mut states = self.states_write();
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
        let mut states = self.states_write();
        let state = states
            .entry(session_id.to_string())
            .or_insert_with(|| SessionLiveState::new(session_id));
        state.status = status;
        state.last_error = last_error;
        state.clone()
    }

    pub fn get(&self, session_id: &str) -> Option<SessionLiveState> {
        self.states_read().get(session_id).cloned()
    }

    pub fn list(&self) -> Vec<SessionLiveState> {
        let mut states: Vec<_> = self.states_read().values().cloned().collect();
        states.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        states
    }
}
