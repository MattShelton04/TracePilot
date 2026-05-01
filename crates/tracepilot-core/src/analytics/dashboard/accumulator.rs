use crate::health;

use super::super::types::{
    AnalyticsData, HealthDistribution, ProductivityMetrics, SessionAnalyticsInput,
};
use super::daily::DailySeriesAccumulator;
use super::durations::compute_duration_stats;
use super::models::ModelDistributionAccumulator;

pub(super) struct AnalyticsAccumulator {
    total_sessions: u32,
    total_tokens: u64,
    total_cost: f64,
    health_score_sum: f64,
    daily: DailySeriesAccumulator,
    model_distribution: ModelDistributionAccumulator,
    durations: Vec<u64>,
    total_turns: u64,
    total_tool_calls: u64,
    total_tokens_from_turns: u64,
    sessions_with_turns: u32,
    total_premium_requests: f64,
    total_api_duration_ms: u64,
    total_tokens_with_duration: u64,
    healthy_count: u32,
    attention_count: u32,
    critical_count: u32,
}

impl AnalyticsAccumulator {
    pub(super) fn new(total_sessions: u32) -> Self {
        Self {
            total_sessions,
            total_tokens: 0,
            total_cost: 0.0,
            health_score_sum: 0.0,
            daily: DailySeriesAccumulator::default(),
            model_distribution: ModelDistributionAccumulator::default(),
            durations: Vec::new(),
            total_turns: 0,
            total_tool_calls: 0,
            total_tokens_from_turns: 0,
            sessions_with_turns: 0,
            total_premium_requests: 0.0,
            total_api_duration_ms: 0,
            total_tokens_with_duration: 0,
            healthy_count: 0,
            attention_count: 0,
            critical_count: 0,
        }
    }

    pub(super) fn record_session(&mut self, input: &SessionAnalyticsInput) {
        let summary = &input.summary;

        let health = health::compute_health(
            summary.event_count,
            summary.shutdown_metrics.as_ref(),
            None,
            None,
        );
        self.health_score_sum += health.score;
        self.record_health_bucket(health.score);

        let date_key = summary.date_key();

        if let Some(ref metrics) = summary.shutdown_metrics {
            if let Some(pr) = metrics.total_premium_requests {
                self.total_premium_requests += pr;
            }

            let session_api_duration_ms = metrics.total_api_duration_ms.unwrap_or(0);
            if session_api_duration_ms > 0 {
                self.durations.push(session_api_duration_ms);
                self.total_api_duration_ms += session_api_duration_ms;
            }

            let model_totals = self
                .model_distribution
                .record_model_metrics(&metrics.model_metrics);
            self.total_tokens += model_totals.tokens;
            self.total_tokens_from_turns += model_totals.tokens;
            self.total_cost += model_totals.cost;

            if let Some(ref segments) = metrics.session_segments {
                self.daily.record_segments(segments);
            } else if let Some(ref date) = date_key {
                self.daily.record_fallback(date, &metrics.model_metrics);
            }

            if session_api_duration_ms > 0 {
                self.total_tokens_with_duration += model_totals.tokens;
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
        let average_health_score = if self.total_sessions > 0 {
            self.health_score_sum / self.total_sessions as f64
        } else {
            0.0
        };

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
            average_health_score,
            token_usage_by_day: daily.token_usage_by_day,
            activity_per_day: daily.activity_per_day,
            model_distribution,
            cost_by_day: daily.cost_by_day,
            api_duration_stats,
            productivity_metrics,
            cache_stats,
            health_distribution: HealthDistribution {
                healthy_count: self.healthy_count,
                attention_count: self.attention_count,
                critical_count: self.critical_count,
            },
            // Note: incident fields default to 0 in fallback path because SessionAnalyticsInput
            // does not carry incident counts. The SQL fast path (query_analytics) returns real values.
            // This is acceptable since the fallback only fires before first indexing.
            sessions_with_errors: 0,
            total_rate_limits: 0,
            total_compactions: 0,
            total_truncations: 0,
            incidents_by_day: Vec::new(),
        }
    }

    fn record_health_bucket(&mut self, score: f64) {
        if score >= 0.8 {
            self.healthy_count += 1;
        } else if score >= 0.5 {
            self.attention_count += 1;
        } else {
            self.critical_count += 1;
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
            (self.total_tokens_with_duration as f64) / (self.total_api_duration_ms as f64 / 1000.0)
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
