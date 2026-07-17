use std::collections::{BTreeMap, HashMap};

use crate::models::event_types::{ModelMetricDetail, SessionSegment};

use super::super::types::{DayActivity, DayCost, DayModelUsage, DayTokens};

#[derive(Default)]
pub(super) struct DailySeriesAccumulator {
    tokens_by_day: BTreeMap<String, u64>,
    activity_by_day: BTreeMap<String, u32>,
    cost_by_day: BTreeMap<String, f64>,
    model_usage_by_day: BTreeMap<(String, String), DayModelUsageTotals>,
}

pub(super) struct DailySeries {
    pub token_usage_by_day: Vec<DayTokens>,
    pub activity_per_day: Vec<DayActivity>,
    pub cost_by_day: Vec<DayCost>,
    pub model_usage_by_day: Vec<DayModelUsage>,
}

impl DailySeriesAccumulator {
    pub(super) fn record_segments(&mut self, segments: &[SessionSegment]) {
        for seg in segments {
            let end_date = date_part(&seg.end_timestamp);
            let start_date = date_part(&seg.start_timestamp);
            let mut seg_tokens: u64 = 0;
            let mut seg_cost: f64 = 0.0;
            if let Some(ref mm) = seg.model_metrics {
                for (model, detail) in mm {
                    let totals = tokens_and_cost(detail);
                    seg_tokens += totals.tokens;
                    seg_cost += totals.cost;
                    self.record_model_usage(&end_date, model, detail);
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
        for (model, detail) in model_metrics {
            let totals = tokens_and_cost(detail);
            fallback_tokens += totals.tokens;
            fallback_cost += totals.cost;
            self.record_model_usage(date, model, detail);
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
            model_usage_by_day: self
                .model_usage_by_day
                .into_values()
                .map(Into::into)
                .collect(),
        }
    }

    fn record_model_usage(&mut self, date: &str, model: &str, detail: &ModelMetricDetail) {
        let Some(usage) = detail.usage.as_ref() else {
            return;
        };
        let key = (date.to_string(), model.to_string());
        let entry = self
            .model_usage_by_day
            .entry(key)
            .or_insert_with(|| DayModelUsageTotals::new(date.to_string(), model.to_string()));
        entry.input_tokens += usage.input_tokens.unwrap_or(0);
        entry.output_tokens += usage.output_tokens.unwrap_or(0);
        entry.cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
        entry.cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
        if let Some(reasoning_tokens) = usage.reasoning_tokens {
            entry.reasoning_tokens_sum += reasoning_tokens;
            entry.has_reasoning_tokens = true;
        }
        if let Some(total_nano_aiu) = detail.total_nano_aiu {
            entry.total_nano_aiu += total_nano_aiu;
            entry.has_observed_ai_credits = true;
        } else {
            entry.unobserved_input_tokens += usage.input_tokens.unwrap_or(0);
            entry.unobserved_output_tokens += usage.output_tokens.unwrap_or(0);
            entry.unobserved_cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
            entry.unobserved_cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
        }
    }
}

#[derive(Default)]
struct DayModelUsageTotals {
    date: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens_sum: u64,
    has_reasoning_tokens: bool,
    total_nano_aiu: u64,
    has_observed_ai_credits: bool,
    unobserved_input_tokens: u64,
    unobserved_output_tokens: u64,
    unobserved_cache_read_tokens: u64,
    unobserved_cache_write_tokens: u64,
}

impl DayModelUsageTotals {
    fn new(date: String, model: String) -> Self {
        Self {
            date,
            model,
            ..Self::default()
        }
    }
}

impl From<DayModelUsageTotals> for DayModelUsage {
    fn from(value: DayModelUsageTotals) -> Self {
        Self {
            date: value.date,
            model: value.model,
            input_tokens: value.input_tokens,
            output_tokens: value.output_tokens,
            cache_read_tokens: value.cache_read_tokens,
            cache_write_tokens: value.cache_write_tokens,
            reasoning_tokens: if value.has_reasoning_tokens {
                Some(value.reasoning_tokens_sum)
            } else {
                None
            },
            total_nano_aiu: value
                .has_observed_ai_credits
                .then_some(value.total_nano_aiu),
            unobserved_input_tokens: value.unobserved_input_tokens,
            unobserved_output_tokens: value.unobserved_output_tokens,
            unobserved_cache_read_tokens: value.unobserved_cache_read_tokens,
            unobserved_cache_write_tokens: value.unobserved_cache_write_tokens,
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
