//! SQL query helpers and statistical functions for the index database.

mod duration;
mod filters;
mod model_distribution;
mod queries;

pub(super) use duration::compute_duration_stats;
pub(super) use filters::{append_segment_date_filter, build_date_repo_filter, build_eq_filter};
pub(super) use model_distribution::query_model_distribution;
#[allow(unused_imports)]
pub(super) use queries::{
    execute_query_map, query_day_activity, query_day_cost, query_day_tokens, query_durations,
    to_refs,
};

#[cfg(test)]
mod tests;
