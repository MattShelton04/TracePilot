//! Sharded live-state store.
//!
//! Storage layout: `RwLock<HashMap<String, Arc<Mutex<SessionLiveState>>>>`.
//! See DEEP-02 in `docs/improvements/repository-improvement-review-2026-05-08`
//! and the rubber-duck design notes for the rationale (≈10–100 sessions,
//! simpler reasoning than DashMap, no shard-guard footguns).
//!
//! Lock-layering rules — every caller MUST follow these:
//!   1. Look up the per-session `Arc<Mutex<…>>` slot under the map's *read*
//!      guard, then drop the map guard *before* locking the slot.
//!   2. Lock the per-session mutex, mutate / snapshot, drop the mutex.
//!   3. Broadcast (if any) outside both locks.
//!
//! Never hold the per-session mutex across `.await`. Never hold the map
//! guard while acquiring the per-session mutex or while broadcasting.
//!
//! Lifecycle rules — see DEEP-01 / DEEP-05:
//!   * `mark_or_insert` is the create-or-update API; use it on
//!     create / resume / running paths only.
//!   * `mark_existing` mutates in place and returns `None` if the slot is
//!     absent; use it on teardown paths after the forwarder is gone so a
//!     synthetic Shutdown emission doesn't resurrect a removed session.
//!   * `remove` is the only API that takes a slot out of the map. Order of
//!     teardown is always `abort() → handle.await → remove(...)`.

use super::reducer;
use super::{SessionLiveState, SessionRuntimeStatus};
use crate::bridge::BridgeEvent;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

type Slot = Arc<Mutex<SessionLiveState>>;

#[derive(Debug, Default)]
pub struct LiveStateStore {
    states: RwLock<HashMap<String, Slot>>,
}

impl LiveStateStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn states_write(&self) -> std::sync::RwLockWriteGuard<'_, HashMap<String, Slot>> {
        self.states.write().unwrap_or_else(|e| {
            tracing::error!(
                helper = "LiveStateStore::states_write",
                "live_state store RwLock poisoned; recovering inner guard to preserve availability"
            );
            e.into_inner()
        })
    }

    fn states_read(&self) -> std::sync::RwLockReadGuard<'_, HashMap<String, Slot>> {
        self.states.read().unwrap_or_else(|e| {
            tracing::error!(
                helper = "LiveStateStore::states_read",
                "live_state store RwLock poisoned; recovering inner guard to preserve availability"
            );
            e.into_inner()
        })
    }

    /// Lock a per-session mutex, recovering from poisoning the same way as
    /// the map RwLock helpers. Callers must already hold an `Arc<Mutex<…>>`
    /// clone (i.e. the map guard has been dropped).
    fn lock_slot(slot: &Slot) -> std::sync::MutexGuard<'_, SessionLiveState> {
        slot.lock().unwrap_or_else(|e| {
            tracing::error!(
                helper = "LiveStateStore::lock_slot",
                "per-session live_state Mutex poisoned; recovering inner guard"
            );
            e.into_inner()
        })
    }

    /// Look up an existing slot under the read guard. Drops the map guard
    /// before returning the cloned `Arc`, satisfying lock-layering rule 1.
    fn lookup(&self, session_id: &str) -> Option<Slot> {
        self.states_read().get(session_id).cloned()
    }

    /// Reduce `event` into the per-session state, creating the slot on first
    /// touch. Read-fast-path: the common case for an already-tracked session
    /// avoids the map's write lock.
    pub fn apply_event(&self, event: &BridgeEvent) -> SessionLiveState {
        let slot = match self.lookup(&event.session_id) {
            Some(s) => s,
            None => {
                let mut map = self.states_write();
                map.entry(event.session_id.clone())
                    .or_insert_with(|| {
                        Arc::new(Mutex::new(SessionLiveState::new(&event.session_id)))
                    })
                    .clone()
            }
        };
        let mut guard = Self::lock_slot(&slot);
        reducer::apply_event(&mut guard, event);
        guard.clone()
    }

    /// Insert-or-update status. Use ONLY on create / resume / running paths;
    /// teardown paths must use [`mark_existing`](Self::mark_existing) or
    /// [`remove`](Self::remove) so a stale terminal status doesn't resurrect
    /// an already-removed session.
    pub fn mark_or_insert(
        &self,
        session_id: &str,
        status: SessionRuntimeStatus,
        last_error: Option<String>,
    ) -> SessionLiveState {
        let slot = match self.lookup(session_id) {
            Some(s) => s,
            None => {
                let mut map = self.states_write();
                map.entry(session_id.to_string())
                    .or_insert_with(|| Arc::new(Mutex::new(SessionLiveState::new(session_id))))
                    .clone()
            }
        };
        let mut guard = Self::lock_slot(&slot);
        guard.status = status;
        guard.last_error = last_error;
        guard.clone()
    }

    /// Mutate an existing slot in place. Returns `None` if the slot has
    /// already been removed — does NOT insert. Used by teardown paths to
    /// emit a final synthetic terminal snapshot without resurrection.
    pub fn mark_existing(
        &self,
        session_id: &str,
        status: SessionRuntimeStatus,
        last_error: Option<String>,
    ) -> Option<SessionLiveState> {
        let slot = self.lookup(session_id)?;
        let mut guard = Self::lock_slot(&slot);
        guard.status = status;
        guard.last_error = last_error;
        Some(guard.clone())
    }

    /// Remove a slot from the map and return its final snapshot. The map's
    /// write guard is dropped before the per-session mutex is locked so the
    /// snapshot doesn't block other slots.
    pub fn remove(&self, session_id: &str) -> Option<SessionLiveState> {
        let slot = {
            let mut map = self.states_write();
            map.remove(session_id)?
        };
        let guard = Self::lock_slot(&slot);
        Some(guard.clone())
    }

    /// Drop every tracked slot. Returns the final snapshots in
    /// `session_id`-ascending order so callers can broadcast per-session
    /// terminal events if desired (today's `disconnect()` chooses silent
    /// clear; see lifecycle.rs).
    pub fn clear(&self) -> Vec<SessionLiveState> {
        let drained: Vec<(String, Slot)> = {
            let mut map = self.states_write();
            map.drain().collect()
        };
        let mut snapshots: Vec<SessionLiveState> = drained
            .into_iter()
            .map(|(_, slot)| Self::lock_slot(&slot).clone())
            .collect();
        snapshots.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        snapshots
    }

    pub fn get(&self, session_id: &str) -> Option<SessionLiveState> {
        let slot = self.lookup(session_id)?;
        Some(Self::lock_slot(&slot).clone())
    }

    pub fn list(&self) -> Vec<SessionLiveState> {
        // Two-pass: clone the `Arc`s under the map read guard, drop it, then
        // snapshot each slot one-by-one. Never hold the map guard across
        // a per-session lock acquisition.
        let slots: Vec<Slot> = self.states_read().values().cloned().collect();
        let mut states: Vec<SessionLiveState> = slots
            .into_iter()
            .map(|slot| Self::lock_slot(&slot).clone())
            .collect();
        states.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        states
    }
}
