//! Integration-style unit tests for [`IndexDb`]. Split into topic-specific
//! submodules so each file stays under the project's 400-LOC budget.

mod agent_runs;
mod agent_usage;
mod analytics;
mod analytics_day_accuracy;
mod analytics_day_series;
mod analytics_parity;
mod analytics_sources;
mod claude_analytics;
mod claude_metrics;
mod common;
mod format_diagnostics;
mod maintenance;
mod metadata_batches;
mod pre_request_record_sessions;
mod prompt_cache;
mod pull_request_status;
mod pull_requests;
mod range_models;
mod range_resumed;
mod range_totals;
mod repository_filter;
mod schema_doc;
mod search_batches;
mod search_content;
mod search_sources;
mod segment_totals;
mod sessions;
mod skill_invocations;
mod snapshots;
mod sources;
mod staleness;
mod transactions;
