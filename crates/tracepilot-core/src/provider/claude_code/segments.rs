//! Per-run usage and per-model cost from `cost-state` snapshots.
//!
//! Snapshots are cumulative across resumes and written at each exit, so one
//! run's usage is its snapshot minus the previous one. The de-duplicated calls
//! after the last snapshot form a final, partial run. Together the runs add up
//! to the session totals in `summary::metrics`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::ClaudeParse;
use super::usage::{ClaudeCallUsage, CostModelUsage, CostSnapshot};
use crate::models::event_types::{ModelMetricDetail, RequestMetrics, UsageMetrics};
use crate::provider::{CostBasis, CostFigure, CostUnit, MetricsSegment};

/// A run before its time span is known.
struct Run {
    span: Option<(DateTime<Utc>, DateTime<Utc>)>,
    requests: u64,
    api_duration_ms: Option<u64>,
    model_metrics: HashMap<String, ModelMetricDetail>,
    cost: Option<CostFigure>,
    partial: bool,
}

/// One segment per run, dated by the main-file records it covers. A run with
/// no timestamped record (an immediate exit) is merged into the next run, or
/// the previous one when it is last.
pub(super) fn run_segments(parsed: &ClaudeParse) -> Vec<MetricsSegment> {
    // Bookkeeping records such as `cost-state` carry no timestamp.
    let times: Vec<(usize, DateTime<Utc>)> = parsed
        .events
        .iter()
        .zip(&parsed.positions)
        .filter_map(|(event, position)| {
            let position = position.as_ref()?;
            if position.file_agent_id.is_some() {
                return None;
            }
            Some((position.line, event.raw.timestamp?))
        })
        .chain(parsed.request_times.iter().copied())
        .collect();
    let span = |after: usize, before: Option<usize>| {
        let mut inside = times
            .iter()
            .filter(|(line, _)| *line > after && before.is_none_or(|end| *line < end))
            .map(|(_, at)| *at);
        let first = inside.next()?;
        Some(inside.fold((first, first), |(lo, hi), at| (lo.min(at), hi.max(at))))
    };

    let last = parsed.cost_snapshots.last();
    let mut runs = Vec::new();
    // A run that ended without writing `cost-state`, before the snapshots'.
    let covers_from = last.map_or(1, |s| s.covers_from);
    let unsnapshotted: Vec<_> = parsed
        .calls
        .iter()
        .filter(|c| c.snapshot_anchor.is_some_and(|a| a < covers_from))
        .collect();
    let mut start = 0;
    if !unsnapshotted.is_empty() {
        runs.push(tail_run(&unsnapshotted, last, span(0, Some(covers_from))));
        start = covers_from - 1;
    }
    let mut previous: Option<&CostSnapshot> = None;
    for snapshot in &parsed.cost_snapshots {
        let after = previous.map_or(start, |p| p.line.max(start));
        let calls: Vec<_> = parsed
            .calls
            .iter()
            .filter(|c| {
                c.snapshot_anchor
                    .is_some_and(|a| a > after && a < snapshot.line)
            })
            .collect();
        runs.push(snapshot_run(
            snapshot,
            previous,
            &calls,
            span(after, Some(snapshot.line)),
        ));
        previous = Some(snapshot);
    }
    let tail: Vec<_> = match last {
        None => parsed.calls.iter().collect(),
        Some(last) => parsed
            .calls
            .iter()
            .filter(|c| c.snapshot_anchor.is_some_and(|a| a > last.line))
            .collect(),
    };
    if !tail.is_empty() {
        runs.push(tail_run(
            &tail,
            last,
            span(previous.map_or(0, |p| p.line), None),
        ));
    }

    let mut segments: Vec<MetricsSegment> = Vec::new();
    let mut pending: Option<Run> = None;
    for mut run in runs {
        if let Some(earlier) = pending.take() {
            merge(&mut run, earlier);
        }
        match run.span {
            Some((start, end)) => segments.push(MetricsSegment {
                start,
                end,
                requests: run.requests,
                api_duration_ms: run.api_duration_ms,
                model_metrics: run.model_metrics,
                cost: run.cost,
                partial: run.partial,
            }),
            None => pending = Some(run),
        }
    }
    if let (Some(run), Some(last)) = (pending, segments.last_mut()) {
        let mut merged = Run {
            span: None,
            requests: last.requests,
            api_duration_ms: last.api_duration_ms,
            model_metrics: std::mem::take(&mut last.model_metrics),
            cost: last.cost,
            partial: last.partial,
        };
        merge(&mut merged, run);
        last.requests = merged.requests;
        last.api_duration_ms = merged.api_duration_ms;
        last.model_metrics = merged.model_metrics;
        last.cost = merged.cost;
        last.partial = merged.partial;
    }
    segments
}

/// The last snapshot's cost per model plus the priced calls it does not
/// cover. A model is left out when its snapshot has no cost or any of its
/// uncovered calls is unpriced.
pub(super) fn model_costs(parsed: &ClaudeParse) -> HashMap<String, f64> {
    let mut costs: HashMap<String, Option<f64>> = HashMap::new();
    let last = parsed.cost_snapshots.last();
    let tail: Vec<_> = match last {
        Some(snapshot) => {
            for (model, usage) in &snapshot.model_usage {
                costs.insert(model.clone(), usage.cost_usd);
            }
            parsed.uncovered_calls().collect()
        }
        None => parsed.calls.iter().collect(),
    };
    for call in tail {
        let entry = costs.entry(model_key(last, call)).or_insert(Some(0.0));
        *entry = entry.and_then(|total| super::pricing::estimate_native(call).map(|c| total + c));
    }
    costs
        .into_iter()
        .filter_map(|(model, cost)| cost.map(|cost| (model, cost)))
        .collect()
}

fn snapshot_run(
    snapshot: &CostSnapshot,
    previous: Option<&CostSnapshot>,
    calls: &[&ClaudeCallUsage],
    span: Option<(DateTime<Utc>, DateTime<Utc>)>,
) -> Run {
    let counts = request_counts(Some(snapshot), calls);
    let mut model_metrics = HashMap::new();
    for (model, usage) in &snapshot.model_usage {
        let earlier = previous.and_then(|p| p.model_usage.get(model));
        let usage = usage_delta(usage, earlier);
        let requests = counts.get(model).copied();
        if requests.is_none() && usage.input_tokens == Some(0) && usage.output_tokens == Some(0) {
            continue;
        }
        model_metrics.insert(model.clone(), detail(usage, requests));
    }
    // A call whose model the snapshot leaves out still counts as a request.
    for (model, count) in counts {
        model_metrics
            .entry(model)
            .or_insert_with(|| ModelMetricDetail {
                requests: Some(RequestMetrics {
                    count: Some(count),
                    cost: None,
                }),
                usage: None,
                total_nano_aiu: None,
                token_details: None,
            });
    }
    let cost = match (snapshot.total_cost_usd, previous) {
        (Some(total), None) => Some(total),
        (Some(total), Some(p)) => p.total_cost_usd.map(|before| (total - before).max(0.0)),
        (None, _) => None,
    };
    Run {
        span,
        requests: calls.len() as u64,
        api_duration_ms: snapshot.total_api_duration_ms.map(|total| {
            total.saturating_sub(previous.and_then(|p| p.total_api_duration_ms).unwrap_or(0))
        }),
        model_metrics,
        cost: cost.map(|amount| CostFigure {
            amount,
            unit: CostUnit::Usd,
            basis: CostBasis::ProviderEstimate,
        }),
        partial: false,
    }
}

/// Calls no snapshot covers, under the model names of `snapshot`, the last.
fn tail_run(
    calls: &[&ClaudeCallUsage],
    snapshot: Option<&CostSnapshot>,
    span: Option<(DateTime<Utc>, DateTime<Utc>)>,
) -> Run {
    let counts = request_counts(snapshot, calls);
    let mut usage: HashMap<String, UsageMetrics> = HashMap::new();
    for call in calls {
        let total = usage
            .entry(model_key(snapshot, call))
            .or_insert_with(|| UsageMetrics {
                input_tokens: Some(0),
                output_tokens: Some(0),
                cache_read_tokens: Some(0),
                cache_write_tokens: Some(0),
                reasoning_tokens: Some(0),
            });
        add(&mut total.input_tokens, call.inclusive_input());
        add(&mut total.output_tokens, call.output_tokens);
        add(&mut total.cache_read_tokens, call.cache_read_tokens);
        add(&mut total.cache_write_tokens, call.cache_write_tokens);
        add(&mut total.reasoning_tokens, call.reasoning_tokens);
    }
    let cost = calls.iter().try_fold(0.0, |total, call| {
        super::pricing::estimate_native(call).map(|amount| total + amount)
    });
    Run {
        span,
        requests: calls.len() as u64,
        api_duration_ms: None,
        model_metrics: usage
            .into_iter()
            .map(|(model, usage)| {
                let requests = counts.get(&model).copied();
                (model, detail(usage, requests))
            })
            .collect(),
        cost: cost.map(super::pricing::estimate),
        partial: true,
    }
}

/// Fold an earlier run that has no time span into `run`.
fn merge(run: &mut Run, earlier: Run) {
    run.requests += earlier.requests;
    run.partial |= earlier.partial;
    run.api_duration_ms = match (run.api_duration_ms, earlier.api_duration_ms) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    };
    run.cost = match (run.cost, earlier.cost) {
        (Some(cost), Some(other)) => Some(CostFigure {
            amount: cost.amount + other.amount,
            ..cost
        }),
        _ => None,
    };
    for (model, other) in earlier.model_metrics {
        match run.model_metrics.get_mut(&model) {
            None => {
                run.model_metrics.insert(model, other);
            }
            Some(detail) => {
                if detail.usage.is_none() {
                    detail.usage = other.usage;
                } else if let (Some(usage), Some(other)) = (detail.usage.as_mut(), other.usage) {
                    add_opt(&mut usage.input_tokens, other.input_tokens);
                    add_opt(&mut usage.output_tokens, other.output_tokens);
                    add_opt(&mut usage.cache_read_tokens, other.cache_read_tokens);
                    add_opt(&mut usage.cache_write_tokens, other.cache_write_tokens);
                    add_opt(&mut usage.reasoning_tokens, other.reasoning_tokens);
                }
                if let Some(count) = other.requests.and_then(|r| r.count) {
                    let requests = detail.requests.get_or_insert(RequestMetrics {
                        count: Some(0),
                        cost: None,
                    });
                    requests.count = Some(requests.count.unwrap_or(0) + count);
                }
            }
        }
    }
}

fn request_counts(
    snapshot: Option<&CostSnapshot>,
    calls: &[&ClaudeCallUsage],
) -> HashMap<String, u64> {
    let mut counts = HashMap::new();
    for call in calls {
        *counts.entry(model_key(snapshot, call)).or_default() += 1;
    }
    counts
}

/// A call's model under the name `snapshot` gives it ([`CostSnapshot::model_key`]).
fn model_key(snapshot: Option<&CostSnapshot>, call: &ClaudeCallUsage) -> String {
    let model = call.model.as_deref().unwrap_or_default();
    snapshot.map_or_else(|| model.to_string(), |s| s.model_key(model))
}

/// Inclusive input, matching `summary::metrics`.
fn usage_delta(usage: &CostModelUsage, earlier: Option<&CostModelUsage>) -> UsageMetrics {
    let zero = CostModelUsage::default();
    let earlier = earlier.unwrap_or(&zero);
    let input = usage.input_tokens.saturating_sub(earlier.input_tokens);
    let read = usage
        .cache_read_input_tokens
        .saturating_sub(earlier.cache_read_input_tokens);
    let write = usage
        .cache_creation_input_tokens
        .saturating_sub(earlier.cache_creation_input_tokens);
    UsageMetrics {
        input_tokens: Some(input + read + write),
        output_tokens: Some(usage.output_tokens.saturating_sub(earlier.output_tokens)),
        cache_read_tokens: Some(read),
        cache_write_tokens: Some(write),
        reasoning_tokens: usage
            .thinking_tokens
            .map(|t| t.saturating_sub(earlier.thinking_tokens.unwrap_or(0))),
    }
}

fn detail(usage: UsageMetrics, requests: Option<u64>) -> ModelMetricDetail {
    ModelMetricDetail {
        requests: requests.map(|count| RequestMetrics {
            count: Some(count),
            cost: None,
        }),
        usage: Some(usage),
        total_nano_aiu: None,
        token_details: None,
    }
}

fn add(total: &mut Option<u64>, value: u64) {
    *total = Some(total.unwrap_or(0) + value);
}

fn add_opt(total: &mut Option<u64>, value: Option<u64>) {
    if let Some(value) = value {
        add(total, value);
    }
}
