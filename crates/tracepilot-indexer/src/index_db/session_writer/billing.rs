//! Billing columns follow the provider's capabilities, not its source name:
//! a source without premium requests or AIC never stores them, whatever its
//! summary carries.

use std::collections::HashMap;

use tracepilot_core::models::event_types::ModelMetricDetail;
use tracepilot_core::provider::SourceCapabilities;

use crate::index_db::types::{SessionAnalytics, SessionSegmentRow};

/// Clear the billing the source does not have. `has_metrics` says whether the
/// provider reported running totals.
pub(super) fn apply(
    analytics: &mut SessionAnalytics,
    capabilities: SourceCapabilities,
    has_metrics: bool,
) {
    if !capabilities.has_premium_requests {
        // The cost columns hold premium-request cost, not USD.
        analytics.total_cost = None;
        analytics.total_premium_requests = None;
        for row in &mut analytics.model_rows {
            row.cost = None;
        }
        for row in &mut analytics.session_segment_rows {
            row.premium_requests = 0.0;
        }
    }
    if !capabilities.has_aic {
        analytics.total_nano_aiu = None;
        for row in &mut analytics.model_rows {
            row.total_nano_aiu = None;
        }
        for row in &mut analytics.session_segment_rows {
            row.total_nano_aiu = None;
        }
        for row in &mut analytics.cache_window_rows {
            row.interaction_nano_aiu = None;
        }
        for run in &mut analytics.agent_runs.runs {
            run.own_nano_aiu = None;
        }
    }
    if !(capabilities.has_premium_requests && capabilities.has_aic) {
        for row in &mut analytics.session_segment_rows {
            strip_segment_models(row, capabilities);
        }
    }
    // Without exit totals, no metrics means no recorded usage: it costs
    // nothing, rather than counting as unpriced.
    if !capabilities.has_exit_metrics && !has_metrics {
        analytics.total_cost_usd = Some(0.0);
    }
}

/// Per-model billing inside a segment's model metrics, which per-day model
/// usage reads back. Rewritten only when it holds a value to clear.
fn strip_segment_models(row: &mut SessionSegmentRow, capabilities: SourceCapabilities) {
    let Some(json) = row.model_metrics_json.as_deref() else {
        return;
    };
    let Ok(mut models) = serde_json::from_str::<HashMap<String, ModelMetricDetail>>(json) else {
        return;
    };
    let mut changed = false;
    for detail in models.values_mut() {
        if !capabilities.has_aic && detail.total_nano_aiu.take().is_some() {
            changed = true;
        }
        if !capabilities.has_premium_requests
            && let Some(requests) = detail.requests.as_mut()
            && requests.cost.take().is_some()
        {
            changed = true;
        }
    }
    if changed {
        row.model_metrics_json = serde_json::to_string(&models).ok();
    }
}
