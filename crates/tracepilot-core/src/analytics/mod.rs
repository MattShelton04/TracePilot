//! Analytics module for aggregating metrics across Copilot CLI sessions.
//!
//! Provides three main analytics functions:
//! - [`compute_analytics`] — Dashboard-level aggregate stats (tokens, cost, trends)
//! - [`compute_tool_analysis`] — Per-tool usage breakdown with heatmap
//! - [`compute_code_impact`] — File change aggregation and trends
//!
//! And two loading tiers for efficiency:
//! - [`load_session_summaries`] — Fast: workspace.yaml only (for analytics + code impact)
//! - [`load_full_sessions`] — Slower: includes turn reconstruction (for tool analysis)

mod code_impact;
mod dashboard;
mod tools;
pub mod loader;
pub mod types;

#[cfg(test)]
mod test_helpers;

pub use code_impact::compute_code_impact;
pub use dashboard::compute_analytics;
pub use tools::compute_tool_analysis;
pub use loader::{
    load_full_sessions, load_full_sessions_filtered, load_session_summaries,
    load_session_summaries_filtered,
};
pub use types::*;
