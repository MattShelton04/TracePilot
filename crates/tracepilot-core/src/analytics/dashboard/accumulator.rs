use super::super::types::{
    AnalyticsData, ProductivityMetrics, PromptCacheAnalytics, SessionAnalyticsInput,
    SourceCostEntry,
};
use super::super::utils::segment_end_date;
use super::DateRange;
use super::daily::{DailySeriesAccumulator, tokens_and_cost};
use super::durations::compute_duration_stats;
use super::models::ModelDistributionAccumulator;
use crate::models::event_types::SessionSegment;
use crate::provider::SessionSource;

/// Usage from a session's segments that ended outside the date range,
/// measured like the indexed `session_segments` columns.
#[derive(Default)]
struct OutsideUsage {
    tokens: u64,
    cost: f64,
    premium_requests: f64,
    nano_aiu: u64,
}

impl OutsideUsage {
    fn add(&mut self, segment: &SessionSegment) {
        for detail in segment.model_metrics.iter().flat_map(|mm| mm.values()) {
            let totals = tokens_and_cost(detail);
            self.tokens += totals.tokens;
            self.cost += totals.cost;
        }
        self.premium_requests += segment.premium_requests;
        self.nano_aiu += segment.total_nano_aiu.unwrap_or(0);
    }
}

pub(super) struct AnalyticsAccumulator {
    total_sessions: u32,
    total_tokens: u64,
    total_cost: f64,
    daily: DailySeriesAccumulator,
    model_distribution: ModelDistributionAccumulator,
    durations: Vec<u64>,
    total_turns: u64,
    total_tool_calls: u64,
    total_tokens_from_turns: u64,
    sessions_with_turns: u32,
    total_premium_requests: f64,
    total_nano_aiu: u64,
    sessions_with_observed_ai_credits: u32,
    total_api_duration_ms: u64,
    output_tokens_with_duration: u64,
}

impl AnalyticsAccumulator {
    pub(super) fn new(total_sessions: u32) -> Self {
        Self {
            total_sessions,
            total_tokens: 0,
            total_cost: 0.0,
            daily: DailySeriesAccumulator::default(),
            model_distribution: ModelDistributionAccumulator::default(),
            durations: Vec::new(),
            total_turns: 0,
            total_tool_calls: 0,
            total_tokens_from_turns: 0,
            sessions_with_turns: 0,
            total_premium_requests: 0.0,
            total_nano_aiu: 0,
            sessions_with_observed_ai_credits: 0,
            total_api_duration_ms: 0,
            output_tokens_with_duration: 0,
        }
    }

    pub(super) fn record_session(&mut self, input: &SessionAnalyticsInput, range: DateRange<'_>) {
        let summary = &input.summary;

        let date_key = summary.date_key();

        if let Some(ref metrics) = summary.shutdown_metrics {
            // Segments that ended on a day outside the range leave the
            // headline usage; undated ones stay with the session.
            let mut outside = OutsideUsage::default();
            let charted: Vec<&SessionSegment> = metrics
                .session_segments
                .iter()
                .flatten()
                .filter(|segment| match segment_end_date(segment) {
                    Some(day) if !range.contains(day) => {
                        outside.add(segment);
                        false
                    }
                    _ => true,
                })
                .collect();

            if let Some(pr) = metrics.total_premium_requests {
                self.total_premium_requests += (pr - outside.premium_requests).max(0.0);
            }
            if let Some(total_nano_aiu) = metrics.total_nano_aiu {
                self.total_nano_aiu += total_nano_aiu.saturating_sub(outside.nano_aiu);
                self.sessions_with_observed_ai_credits += 1;
            }

            let session_api_duration_ms = metrics.total_api_duration_ms.unwrap_or(0);
            if session_api_duration_ms > 0 {
                self.durations.push(session_api_duration_ms);
                self.total_api_duration_ms += session_api_duration_ms;
            }

            let model_totals = self
                .model_distribution
                .record_model_metrics(&metrics.model_metrics);
            self.total_tokens += model_totals.tokens.saturating_sub(outside.tokens);
            // Whole-session tokens, divided by whole-session turns.
            self.total_tokens_from_turns += model_totals.tokens;
            self.total_cost += (model_totals.cost - outside.cost).max(0.0);

            if metrics.session_segments.is_some() {
                self.daily.record_segments(charted);
            } else if let Some(ref date) = date_key {
                self.daily.record_fallback(date, &metrics.model_metrics);
            }

            if session_api_duration_ms > 0 {
                self.output_tokens_with_duration += model_totals.output_tokens;
            }
        }

        if let Some(turn_count) = summary.turn_count {
            let tc = turn_count as u64;
            self.total_turns += tc;
            if tc > 0 {
                self.sessions_with_turns += 1;
            }
        }

        if let Some(ref turns) = input.turns {
            for turn in turns {
                self.total_tool_calls += turn.tool_calls.len() as u64;
            }
        }
    }

    pub(super) fn into_analytics_data(self) -> AnalyticsData {
        let api_duration_stats = compute_duration_stats(&self.durations);
        let productivity_metrics = self.productivity_metrics();
        let cache_stats = self.model_distribution.cache_stats();
        let model_distribution = self.model_distribution.into_model_distribution();
        let daily = self.daily.into_series();

        AnalyticsData {
            total_sessions: self.total_sessions,
            total_tokens: self.total_tokens,
            total_cost: self.total_cost,
            total_premium_requests: self.total_premium_requests,
            total_nano_aiu: self.total_nano_aiu,
            sessions_with_observed_ai_credits: self.sessions_with_observed_ai_credits,
            token_usage_by_day: daily.token_usage_by_day,
            activity_per_day: daily.activity_per_day,
            model_distribution,
            cost_by_day: daily.cost_by_day,
            model_usage_by_day: daily.model_usage_by_day,
            api_duration_stats,
            productivity_metrics,
            cache_stats,
            // Note: incident fields default to 0 in fallback path because SessionAnalyticsInput
            // does not carry incident counts. The SQL fast path (query_analytics) returns real values.
            // This is acceptable since the fallback only fires before first indexing.
            sessions_with_errors: 0,
            total_rate_limits: 0,
            total_compactions: 0,
            total_truncations: 0,
            incidents_by_day: Vec::new(),
            // Cache windows are only available from the index.
            prompt_cache: PromptCacheAnalytics::default(),
            // The disk fallback reads Copilot sessions only, which have no USD.
            cost_by_source: (self.total_sessions > 0)
                .then_some(SourceCostEntry {
                    source: SessionSource::Copilot,
                    sessions: self.total_sessions,
                    tokens: self.total_tokens,
                    cost_usd: None,
                    sessions_with_cost_usd: 0,
                })
                .into_iter()
                .collect(),
            cost_usd_by_day: Vec::new(),
        }
    }

    fn productivity_metrics(&self) -> ProductivityMetrics {
        let avg_turns_per_session = if self.sessions_with_turns > 0 {
            self.total_turns as f64 / self.sessions_with_turns as f64
        } else {
            0.0
        };
        let avg_tool_calls_per_turn = if self.total_turns > 0 {
            self.total_tool_calls as f64 / self.total_turns as f64
        } else {
            0.0
        };
        let avg_tokens_per_turn = if self.total_turns > 0 {
            self.total_tokens_from_turns as f64 / self.total_turns as f64
        } else {
            0.0
        };
        let avg_tokens_per_api_second = if self.total_api_duration_ms > 0 {
            (self.output_tokens_with_duration as f64) / (self.total_api_duration_ms as f64 / 1000.0)
        } else {
            0.0
        };

        ProductivityMetrics {
            avg_turns_per_session,
            avg_tool_calls_per_turn,
            avg_tokens_per_turn,
            avg_tokens_per_api_second,
        }
    }
}
