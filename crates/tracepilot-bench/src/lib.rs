//! Synthetic data generators and benchmarking utilities for TracePilot.
//!
//! Provides deterministic, configurable session fixtures for Criterion benchmarks.

mod analytics;
mod builder;
mod events;
mod profiles;
mod workspace;

pub use analytics::generate_analytics_inputs;
pub use builder::{
    SessionFixtureBuilder, create_multi_session_fixture, create_session_fixture,
    generate_events_jsonl_string, generate_raw_events,
};
pub use profiles::{SessionProfile, create_varied_session_fixture};
