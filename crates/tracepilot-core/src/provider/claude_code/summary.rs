//! C5: recorded metadata and cumulative snapshot + de-duplicated tail usage.

use std::collections::{BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Utc};

use super::prompts::without_paste_tags;
use super::records::{Blocks, Rec, block_type};
use super::{ClaudeCallUsage, ClaudeParse};
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
    let mut custom_title = None;
    let mut title = None;
    let mut agent_name = None;
    let mut prompt = None;
    let mut command = None;
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
            "custom-title" => {
                if let Some(value) = nonempty(&data["customTitle"]) {
                    custom_title = Some(value);
                }
            }
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
        if event.raw.event_type == "user.message" && !position.abandoned {
            let source = event.raw.data["source"].as_str().unwrap_or("");
            if prompt.is_none() && source == "user" {
                prompt = nonempty(&event.raw.data["content"])
                    .map(|text| without_paste_tags(&text))
                    .filter(|text| !text.is_empty());
            } else if command.is_none() && source.starts_with("command-") {
                command = nonempty(&event.raw.data["content"]);
            }
        }
    }
    // A session of slash commands only, with no prompt and no model call, is
    // empty, like a Copilot session nobody typed into: "hide empty" hides it,
    // and it is untitled unless renamed. One whose command ran the model
    // (`/init`) is named after that command.
    let empty = prompt.is_none() && parsed.calls.is_empty();
    if empty {
        summary.turn_count = Some(0);
    }
    let command = command.filter(|_| !empty);
    // The user's own name (`/rename`) beats the generated one, whichever came
    // last.
    summary.summary = custom_title.or(title).or(agent_name).or(prompt).or(command);
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
    // Calls join their model's row under the snapshot's name for it.
    let key = |call: &ClaudeCallUsage| {
        let model = call.model.as_deref().unwrap_or_default();
        snapshot.map_or_else(|| model.to_string(), |s| s.model_key(model))
    };
    // Snapshots have no request counts. Preserve the observed counts separately
    // from their cumulative token totals; side models have no recorded count.
    for call in &parsed.calls {
        let model = models.entry(key(call)).or_insert_with(detail);
        let requests = model.requests.get_or_insert(RequestMetrics {
            count: Some(0),
            cost: None,
        });
        requests.count = Some(requests.count.unwrap_or(0) + 1);
    }
    let tail: Vec<_> = if snapshot.is_some() {
        parsed.uncovered_calls().collect()
    } else {
        parsed.calls.iter().collect()
    };
    for call in &tail {
        if let Some(usage) = models
            .get_mut(&key(call))
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
    let Edits {
        files,
        lines,
        tail_lines,
    } = edits(parsed);
    // Claude Code writes its own line totals into `cost-state` on exit. Edits
    // it has not covered (a running session, or a run that has not exited or
    // was killed) are counted from their results' patches, which is how
    // Claude Code counts them, on top of the last snapshot like tokens.
    let (lines_added, lines_removed) = match snapshot {
        Some(s) => (
            s.total_lines_added.map(|n| n + tail_lines.0),
            s.total_lines_removed.map(|n| n + tail_lines.1),
        ),
        None => lines.unzip(),
    };
    let code_changes = (snapshot.is_some() || !files.is_empty()).then(|| CodeChanges {
        lines_added,
        lines_removed,
        files_modified: (!files.is_empty()).then(|| files.into_iter().collect()),
    });
    // API time the snapshot does not cover (all of it without one) is
    // estimated per call from transcript timestamps. Wall-clock and tool time
    // stay the snapshot's: a resumed run's start and exit are not recorded.
    let tail_api_duration = tail
        .iter()
        .filter_map(|call| call.api_duration_ms())
        .reduce(|total, ms| total + ms);
    let (api_duration, duration) = match snapshot {
        Some(s) => (
            s.total_api_duration_ms
                .map(|ms| ms + tail_api_duration.unwrap_or(0)),
            s.total_duration_ms,
        ),
        None => (
            tail_api_duration,
            summary
                .created_at
                .zip(summary.updated_at)
                .and_then(|(start, end)| u64::try_from((end - start).num_milliseconds()).ok()),
        ),
    };
    Some(SessionMetrics {
        total_api_duration_ms: api_duration,
        total_api_duration_without_retries_ms: snapshot
            .and_then(|s| s.total_api_duration_without_retries_ms),
        total_tool_duration_ms: snapshot.and_then(|s| s.total_tool_duration_ms),
        total_duration_ms: duration,
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
            unfinished_tail_calls: tail.iter().filter(|c| c.stop_reason.is_none()).count(),
            snapshot_cost,
        }),
        model_costs: super::segments::model_costs(parsed),
        segments: super::segments::run_segments(parsed),
    })
}

/// What the session's successful edits changed.
struct Edits {
    files: BTreeSet<String>,
    /// Lines added and removed by the edit results that carry a patch, `None`
    /// when none does.
    lines: Option<(u64, u64)>,
    /// The part of `lines` from edits made by calls the last snapshot does
    /// not cover ([`ClaudeParse::uncovered_calls`]).
    tail_lines: (u64, u64),
}

fn edits(parsed: &ClaudeParse) -> Edits {
    let tail: HashSet<&str> = parsed
        .uncovered_calls()
        .map(|call| call.message_id.as_str())
        .collect();
    let mut files = BTreeSet::new();
    let mut lines: Option<(u64, u64)> = None;
    let mut tail_lines = (0, 0);
    // Each edit `tool_use`, and whether the call that made it is in the tail.
    let mut edits = HashMap::new();
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
                    let in_tail = Rec(data).message_id().is_some_and(|m| tail.contains(m));
                    edits.insert((owner, id), in_tail);
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
                && let Some(&in_tail) = result["tool_use_id"]
                    .as_str()
                    .and_then(|id| edits.get(&(owner, id)))
                && let Some(path) = nonempty(&data["toolUseResult"]["filePath"])
            {
                files.insert(path);
                if let Some((added, removed)) = patch_lines(&data["toolUseResult"]) {
                    let total = lines.get_or_insert((0, 0));
                    total.0 += added;
                    total.1 += removed;
                    if in_tail {
                        tail_lines.0 += added;
                        tail_lines.1 += removed;
                    }
                }
            }
        }
    }
    Edits {
        files,
        lines,
        tail_lines,
    }
}

/// Lines an edit result added and removed: its `structuredPatch` hunks, or
/// every line of a file `Write` created (whose patch is empty).
fn patch_lines(result: &serde_json::Value) -> Option<(u64, u64)> {
    let hunks = result["structuredPatch"].as_array()?;
    if hunks.is_empty() {
        let content = result["content"]
            .as_str()
            .filter(|_| result["type"] == "create")?;
        return Some((content.lines().count() as u64, 0));
    }
    let mut counts = (0, 0);
    for line in hunks.iter().filter_map(|h| h["lines"].as_array()).flatten() {
        match line.as_str().and_then(|l| l.chars().next()) {
            Some('+') => counts.0 += 1,
            Some('-') => counts.1 += 1,
            _ => {}
        }
    }
    Some(counts)
}
