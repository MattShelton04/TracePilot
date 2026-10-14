//! SQL query helpers and statistical functions for the index database.

mod duration;
mod filters;
mod model_distribution;
mod queries;
mod range_usage;

pub(super) use duration::compute_duration_stats;
pub(super) use filters::{
    append_segment_date_filter, append_source_filter, build_date_repo_filter, build_eq_filter,
};
pub(super) use model_distribution::query_model_distribution;
#[allow(unused_imports)]
pub(super) use queries::{execute_query_map, query_durations, to_refs};
pub(super) use range_usage::{
    IN_RANGE_COST, IN_RANGE_COST_USD, IN_RANGE_NANO_AIU, IN_RANGE_PREMIUM, IN_RANGE_TOKENS,
    in_range_models_cte, out_of_range_join,
};

#[cfg(test)]
mod tests;
