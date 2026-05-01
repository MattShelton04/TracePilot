use std::collections::{BTreeMap, HashMap};

use crate::models::event_types::{ModelMetricDetail, SessionSegment};

use super::super::types::{DayActivity, DayCost, DayTokens};

#[derive(Default)]
pub(super) struct DailySeriesAccumulator {
    tokens_by_day: BTreeMap<String, u64>,
    activity_by_day: BTreeMap<String, u32>,
    cost_by_day: BTreeMap<String, f64>,
}

pub(super) struct DailySeries {
    pub token_usage_by_day: Vec<DayTokens>,
    pub activity_per_day: Vec<DayActivity>,
    pub cost_by_day: Vec<DayCost>,
}

impl DailySeriesAccumulator {
    pub(super) fn record_segments(&mut self, segments: &[SessionSegment]) {
        for seg in segments {
            let end_date = date_part(&seg.end_timestamp);
            let start_date = date_part(&seg.start_timestamp);
            let mut seg_tokens: u64 = 0;
            let mut seg_cost: f64 = 0.0;
            if let Some(ref mm) = seg.model_metrics {
                for detail in mm.values() {
                    let totals = tokens_and_cost(detail);
                    seg_tokens += totals.tokens;
                    seg_cost += totals.cost;
                }
            }
            *self.tokens_by_day.entry(end_date.clone()).or_insert(0) += seg_tokens;
            *self.cost_by_day.entry(end_date).or_insert(0.0) += seg_cost;
            *self.activity_by_day.entry(start_date).or_insert(0) += 1;
        }
    }

    pub(super) fn record_fallback(
        &mut self,
        date: &str,
        model_metrics: &HashMap<String, ModelMetricDetail>,
    ) {
        *self.activity_by_day.entry(date.to_string()).or_insert(0) += 1;
        let mut fallback_tokens = 0;
        let mut fallback_cost = 0.0;
        for detail in model_metrics.values() {
            let totals = tokens_and_cost(detail);
            fallback_tokens += totals.tokens;
            fallback_cost += totals.cost;
        }
        if fallback_tokens > 0 {
            *self.tokens_by_day.entry(date.to_string()).or_insert(0) += fallback_tokens;
        }
        if fallback_cost > 0.0 {
            *self.cost_by_day.entry(date.to_string()).or_insert(0.0) += fallback_cost;
        }
    }

    pub(super) fn into_series(self) -> DailySeries {
        DailySeries {
            token_usage_by_day: self
                .tokens_by_day
                .into_iter()
                .map(|(date, tokens)| DayTokens { date, tokens })
                .collect(),
            activity_per_day: self
                .activity_by_day
                .into_iter()
                .map(|(date, count)| DayActivity { date, count })
                .collect(),
            cost_by_day: self
                .cost_by_day
                .into_iter()
                .map(|(date, cost)| DayCost { date, cost })
                .collect(),
        }
    }
}

struct DetailTotals {
    tokens: u64,
    cost: f64,
}

fn tokens_and_cost(detail: &ModelMetricDetail) -> DetailTotals {
    let tokens = detail
        .usage
        .as_ref()
        .map(|usage| usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0))
        .unwrap_or(0);
    let cost = detail
        .requests
        .as_ref()
        .map(|requests| requests.cost.unwrap_or(0.0))
        .unwrap_or(0.0);
    DetailTotals { tokens, cost }
}

fn date_part(timestamp: &str) -> String {
    timestamp.split('T').next().unwrap_or(timestamp).to_string()
}
