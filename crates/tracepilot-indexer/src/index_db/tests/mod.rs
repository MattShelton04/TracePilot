//! Integration-style unit tests for [`IndexDb`]. Split into topic-specific
//! submodules so each file stays under the project's 400-LOC budget.

mod agent_runs;
mod agent_usage;
mod analytics;
mod analytics_parity;
mod analytics_sources;
mod claude_analytics;
mod claude_metrics;
mod common;
mod maintenance;
mod prompt_cache;
mod search_batches;
mod search_content;
mod sessions;
mod skill_invocations;
mod snapshots;
mod sources;
