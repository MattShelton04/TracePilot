//! Subagent attribution — maps orchestrator subagents to task IDs.
//!
//! The orchestrator names each subagent `tp-{task_id}`. This module parses
//! the orchestrator's `events.jsonl` to track which subagent is working on
//! which task, enabling real-time status attribution in the UI.

mod tracker;

pub use tracker::*;
