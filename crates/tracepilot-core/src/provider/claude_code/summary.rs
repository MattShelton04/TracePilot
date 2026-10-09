//! C5: recorded metadata and cumulative snapshot + de-duplicated tail usage.

use std::collections::{BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Utc};

use super::ClaudeParse;
use super::records::{Blocks, Rec, block_type};
use crate::ids::SessionId;
use crate::models::conversation::ConversationTurn;
use crate::models::event_types::{CodeChanges, ModelMetricDetail, RequestMetrics, UsageMetrics};
use crate::models::session_summary::SessionSummary;
use crate::provider::{CostBasis, CostFigure, CostUnit, MetricsCoverage, SessionMetrics};
use crate::summary::summary_from_events;

pub(super) fn summarize(
    id: &SessionId,
    parsed: &ClaudeParse,
) -> (
    SessionSummary,
    Vec<ConversationTurn>,
    Option<SessionMetrics>,
) {
    let (mut summary, turns) = summary_from_events(id, &parsed.events);
    summary.has_events = true;
    let mut title = None;
    let mut agent_name = None;
    let mut prompt = None;
    let mut origin = None;
    let mut pr_repository = None;
    for (event, position) in parsed.events.iter().zip(&parsed.positions) {
        let (Some(native), Some(position)) = (&event.raw.native, position) else {
            continue;
        };
        if position.file_agent_id.is_some() {
            continue;
        }
        let data = &native.data;
        let ts = data["timestamp"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc));
        if let Some(ts) = ts {
            summary.created_at = Some(summary.created_at.map_or(ts, |old| old.min(ts)));
            summary.updated_at = Some(summary.updated_at.map_or(ts, |old| old.max(ts)));
        }
        // Metadata follows file order, even when its wall clock goes backwards.
        if let Some(cwd) = nonempty(&data["cwd"]) {
            summary.cwd = Some(cwd);
        }
        let git = data.pointer("/serverClassifierContext/context/git_state");
        if let Some(branch) =
            nonempty(&data["gitBranch"]).or_else(|| git.and_then(|g| nonempty(&g["branch"])))
        {
            summary.branch = Some(branch);
        }
        if let Some(repository) = git
            .and_then(|g| g.pointer("/visibility/origin/remote"))
            .and_then(nonempty)
        {
            origin = Some(repository);
        }
        match native.record_type.as_str() {
            "ai-title" => {
                if let Some(value) = nonempty(&data["aiTitle"]) {
                    title = Some(value);
                }
            }
            "agent-name" => {
                if let Some(value) = nonempty(&data["agentName"]) {
                    agent_name = Some(value);
                }
            }
            "pr-link" => {
                if let Some(value) = nonempty(&data["prRepository"]) {
                    pr_repository = Some(value);
                }
            }
            _ => {}
        }
        if prompt.is_none()
            && event.raw.event_type == "user.message"
            && event.raw.data["source"] == "user"
            && !position.abandoned
        {
            prompt = nonempty(&event.raw.data["content"]);
        }
    }
    summary.summary = title.or(agent_name).or(prompt);
    summary.repository = origin.or(pr_repository);
    if let Some(start) = parsed
        .cost_snapshots
        .last()
        .and_then(|s| s.start_time)
        .and_then(|ms| i64::try_from(ms).ok())
        .and_then(DateTime::from_timestamp_millis)
    {
        summary.created_at = Some(summary.created_at.map_or(start, |old| old.min(start)));
    }
    let metrics = metrics(parsed, &summary);
    summary.shutdown_metrics = metrics.clone().map(Into::into);
    (summary, turns, metrics)
}

fn nonempty(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

fn detail() -> ModelMetricDetail {
    ModelMetricDetail {
        requests: None,
        usage: Some(UsageMetrics {
            input_tokens: Some(0),
            output_tokens: Some(0),
            cache_read_tokens: Some(0),
            cache_write_tokens: Some(0),
            reasoning_tokens: None,
        }),
        total_nano_aiu: None,
        token_details: None,
    }
}

fn metrics(parsed: &ClaudeParse, summary: &SessionSummary) -> Option<SessionMetrics> {
    let snapshot = parsed.cost_snapshots.last();
    if snapshot.is_none() && parsed.calls.is_empty() {
        return None;
    }
    let mut models: HashMap<String, ModelMetricDetail> = HashMap::new();
    if let Some(snapshot) = snapshot {
        for (model, usage) in &snapshot.model_usage {
            let mut model_detail = detail();
            model_detail.usage = Some(UsageMetrics {
                input_tokens: Some(
                    usage.input_tokens
                        + usage.cache_read_input_tokens
                        + usage.cache_creation_input_tokens,
                ),
                output_tokens: Some(usage.output_tokens),
                cache_read_tokens: Some(usage.cache_read_input_tokens),
                cache_write_tokens: Some(usage.cache_creation_input_tokens),
                reasoning_tokens: usage.thinking_tokens,
            });
            models.insert(model.clone(), model_detail);
        }
    }
    // Snapshots have no request counts. Preserve the observed counts separately
    // from their cumulative token totals; side models have no recorded count.
    for call in &parsed.calls {
        let model = models
            .entry(call.model.clone().unwrap_or_default())
            .or_insert_with(detail);
        let requests = model.requests.get_or_insert(RequestMetrics {
            count: Some(0),
            cost: None,
        });
        requests.count = Some(requests.count.unwrap_or(0) + 1);
    }
    let tail: Vec<_> = if snapshot.is_some() {
        parsed.tail_calls().collect()
    } else {
        parsed.calls.iter().collect()
    };
    for call in &tail {
        if let Some(usage) = models
            .get_mut(&call.model.clone().unwrap_or_default())
            .and_then(|model| model.usage.as_mut())
        {
            usage.input_tokens = Some(usage.input_tokens.unwrap_or(0) + call.inclusive_input());
            usage.output_tokens = Some(usage.output_tokens.unwrap_or(0) + call.output_tokens);
            usage.cache_read_tokens =
                Some(usage.cache_read_tokens.unwrap_or(0) + call.cache_read_tokens);
            usage.cache_write_tokens =
                Some(usage.cache_write_tokens.unwrap_or(0) + call.cache_write_tokens);
            usage.reasoning_tokens =
                Some(usage.reasoning_tokens.unwrap_or(0) + call.reasoning_tokens);
        }
    }
    let snapshot_cost = snapshot
        .and_then(|s| s.total_cost_usd)
        .map(|amount| CostFigure {
            amount,
            unit: CostUnit::Usd,
            basis: CostBasis::ProviderEstimate,
        });
    let cost = if tail.is_empty() {
        snapshot_cost
    } else {
        let base = if snapshot.is_some() {
            snapshot_cost.map(|c| c.amount)
        } else {
            Some(0.0)
        };
        base.and_then(|base| {
            tail.iter().try_fold(base, |total, call| {
                super::pricing::estimate_native(call).map(|amount| total + amount)
            })
        })
        .map(super::pricing::estimate)
    };
    let files = modified_files(parsed);
    let code_changes = (snapshot.is_some() || !files.is_empty()).then(|| CodeChanges {
        lines_added: snapshot.and_then(|s| s.total_lines_added),
        lines_removed: snapshot.and_then(|s| s.total_lines_removed),
        files_modified: (!files.is_empty()).then(|| files.into_iter().collect()),
    });
    Some(SessionMetrics {
        total_api_duration_ms: snapshot.and_then(|s| s.total_api_duration_ms),
        total_api_duration_without_retries_ms: snapshot
            .and_then(|s| s.total_api_duration_without_retries_ms),
        total_tool_duration_ms: snapshot.and_then(|s| s.total_tool_duration_ms),
        total_duration_ms: snapshot.and_then(|s| s.total_duration_ms),
        session_start_time: snapshot.and_then(|s| s.start_time).or_else(|| {
            summary
                .created_at
                .and_then(|t| u64::try_from(t.timestamp_millis()).ok())
        }),
        current_model: summary.current_model.clone(),
        model_metrics: models,
        code_changes,
        cost,
        coverage: Some(MetricsCoverage {
            partial: true,
            snapshot_line: snapshot.map(|s| s.line),
            recorded_calls: parsed.calls.len(),
            tail_calls: tail.len(),
            snapshot_cost,
        }),
        model_costs: super::segments::model_costs(parsed),
        segments: super::segments::run_segments(parsed),
    })
}

fn modified_files(parsed: &ClaudeParse) -> BTreeSet<String> {
    let mut files = BTreeSet::new();
    let mut edits = HashSet::new();
    let mut seen = HashSet::new();
    for (event, position) in parsed.events.iter().zip(&parsed.positions) {
        let (Some(native), Some(position)) = (&event.raw.native, position) else {
            continue;
        };
        let owner = position.file_agent_id.as_deref();
        // One native record can back multiple canonical events. Rewound
        // records still changed disk, even though they have no canonical success.
        if !seen.insert((owner, position.line)) {
            continue;
        }
        let data = &native.data;
        if native.record_type == "attachment:edited_text_file" {
            if let Some(path) = nonempty(&data["attachment"]["filename"]) {
                files.insert(path);
            }
            continue;
        }
        let Blocks::Array(blocks) = Rec(data).blocks() else {
            continue;
        };
        if native.record_type == "assistant" {
            for block in blocks {
                if block_type(block) == "tool_use"
                    && matches!(
                        block["name"].as_str(),
                        Some("Edit" | "Write" | "MultiEdit" | "NotebookEdit")
                    )
                    && let Some(id) = block["id"].as_str().filter(|id| !id.is_empty())
                {
                    edits.insert((owner, id));
                }
            }
        } else if native.record_type == "user" {
            let mut results = blocks.iter().filter(|b| block_type(b) == "tool_result");
            // A record-level toolUseResult cannot identify which result owns
            // it when several results share that record (the WP9 rule).
            let (Some(result), None) = (results.next(), results.next()) else {
                continue;
            };
            if result["is_error"] != true
                && result["tool_use_id"]
                    .as_str()
                    .is_some_and(|id| edits.contains(&(owner, id)))
                && let Some(path) = nonempty(&data["toolUseResult"]["filePath"])
            {
                files.insert(path);
            }
        }
    }
    files
}
