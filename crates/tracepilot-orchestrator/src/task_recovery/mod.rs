//! Orchestrator recovery — heartbeat monitoring and stale detection.
//!
//! When the orchestrator session stops unexpectedly, the app detects this
//! via missing heartbeats and can relaunch with a fresh session.

mod health;

pub use health::*;
