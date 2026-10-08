//! Per-call usage and `cost-state` snapshots.
//!
//! Each API call repeats its usage on every content-block record, and
//! `output_tokens` grows across them, so calls are de-duplicated by
//! `message.id` and the last record wins (data-comparison rule 3). Token
//! categories are kept as Claude reports them; [`ClaudeCallUsage::inclusive_input`]
//! gives TracePilot's inclusive input (rule 4).

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::records::{Rec, WireUsage};
use crate::parsing::events::RawEvent;

/// Usage of one API call (`message.id`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCallUsage {
    pub message_id: String,
    pub model: Option<String>,
    /// Subagent that made the call; `None` for the main agent.
    pub agent_id: Option<String>,
    /// Uncached input (Anthropic convention: excludes cache reads and writes).
    pub input_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_write_5m_tokens: u64,
    pub cache_write_1h_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub stop_reason: Option<String>,
    /// 1-based line of the call's first record in its own file.
    pub line: usize,
    /// Main-file line that orders this call against `cost-state` snapshots:
    /// its own line in the main file, or the line of the `Agent` call that
    /// launched its subagent. `None` for orphan subagents.
    pub snapshot_anchor: Option<usize>,
    /// The call is on a rewound branch. It still counts: it was billed.
    pub abandoned: bool,
}

impl ClaudeCallUsage {
    /// Input including cache reads and writes, matching Copilot's `inputTokens`.
    pub fn inclusive_input(&self) -> u64 {
        self.input_tokens + self.cache_read_tokens + self.cache_write_tokens
    }
}

/// Token sums in Claude's categories.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub calls: u64,
    pub input_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub output_tokens: u64,
}

impl TokenTotals {
    pub fn add(&mut self, call: &ClaudeCallUsage) {
        self.calls += 1;
        self.input_tokens += call.input_tokens;
        self.cache_read_tokens += call.cache_read_tokens;
        self.cache_write_tokens += call.cache_write_tokens;
        self.output_tokens += call.output_tokens;
    }
}

/// Sum calls per model (unknown model as `""`).
pub fn sum_calls_by_model<'a>(
    calls: impl IntoIterator<Item = &'a ClaudeCallUsage>,
) -> BTreeMap<String, TokenTotals> {
    let mut totals: BTreeMap<String, TokenTotals> = BTreeMap::new();
    for call in calls {
        totals
            .entry(call.model.clone().unwrap_or_default())
            .or_default()
            .add(call);
    }
    totals
}

/// One distinct `cost-state` record. Totals are cumulative across resumes and
/// cover the records before `line`, subagents and side models included.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSnapshot {
    /// 1-based main-file line of the first record of an identical run.
    pub line: usize,
    pub total_cost_usd: Option<f64>,
    pub total_api_duration_ms: Option<u64>,
    pub total_api_duration_without_retries_ms: Option<u64>,
    pub total_tool_duration_ms: Option<u64>,
    pub start_time: Option<u64>,
    pub total_duration_ms: Option<u64>,
    pub total_lines_added: Option<u64>,
    pub total_lines_removed: Option<u64>,
    pub model_usage: BTreeMap<String, CostModelUsage>,
}

/// `cost-state.modelUsage[model]`. `input_tokens` excludes cache tokens.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CostModelUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub thinking_tokens: Option<u64>,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub web_search_requests: u64,
    #[serde(rename = "costUSD")]
    pub cost_usd: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct WireCostState {
    #[serde(rename = "totalCostUSD")]
    total_cost_usd: Option<f64>,
    #[serde(rename = "totalAPIDuration")]
    total_api_duration: Option<u64>,
    #[serde(rename = "totalAPIDurationWithoutRetries")]
    total_api_duration_without_retries: Option<u64>,
    total_tool_duration: Option<u64>,
    start_time: Option<u64>,
    total_duration: Option<u64>,
    total_lines_added: Option<u64>,
    total_lines_removed: Option<u64>,
    model_usage: BTreeMap<String, CostModelUsage>,
}

impl CostSnapshot {
    pub(super) fn from_record(record: &Value, line: usize) -> Option<Self> {
        let wire = WireCostState::deserialize(record).ok()?;
        Some(Self {
            line,
            total_cost_usd: wire.total_cost_usd,
            total_api_duration_ms: wire.total_api_duration,
            total_api_duration_without_retries_ms: wire.total_api_duration_without_retries,
            total_tool_duration_ms: wire.total_tool_duration,
            start_time: wire.start_time,
            total_duration_ms: wire.total_duration,
            total_lines_added: wire.total_lines_added,
            total_lines_removed: wire.total_lines_removed,
            model_usage: wire.model_usage,
        })
    }

    /// Same token totals and cost as `other`. Durations are ignored: the two
    /// records Claude Code writes at one exit can differ in wall time only.
    pub(super) fn same_totals(&self, other: &Self) -> bool {
        self.model_usage == other.model_usage && self.total_cost_usd == other.total_cost_usd
    }
}

/// Where a call is recorded, for [`CallTable::observe`].
pub(super) struct CallSite<'a> {
    pub(super) agent_id: Option<&'a str>,
    pub(super) line: usize,
    pub(super) snapshot_anchor: Option<usize>,
    pub(super) abandoned: bool,
}

#[derive(Default)]
pub(super) struct CallTable {
    pub(super) calls: Vec<ClaudeCallUsage>,
    index: HashMap<String, usize>,
}

impl CallTable {
    /// Record an assistant record's usage. Synthetic error records are not
    /// model calls.
    pub(super) fn observe(&mut self, rec: Rec<'_>, site: CallSite<'_>) {
        let Some(id) = rec.message_id() else {
            return;
        };
        if rec.is_synthetic_error() {
            return;
        }
        let usage = rec
            .0
            .pointer("/message/usage")
            .and_then(|u| WireUsage::deserialize(u).ok())
            .unwrap_or_default();
        let stop_reason = rec.ptr_str("/message/stop_reason").map(str::to_string);
        let slot = *self.index.entry(id.to_string()).or_insert_with(|| {
            self.calls.push(ClaudeCallUsage {
                message_id: id.to_string(),
                model: rec.model().map(str::to_string),
                agent_id: site.agent_id.map(str::to_string),
                input_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                cache_write_5m_tokens: 0,
                cache_write_1h_tokens: 0,
                output_tokens: 0,
                reasoning_tokens: 0,
                stop_reason: None,
                line: site.line,
                snapshot_anchor: site.snapshot_anchor,
                abandoned: site.abandoned,
            });
            self.calls.len() - 1
        });
        let call = &mut self.calls[slot];
        call.input_tokens = usage.input_tokens;
        call.cache_read_tokens = usage.cache_read_input_tokens;
        call.cache_write_tokens = usage.cache_creation_input_tokens;
        call.cache_write_5m_tokens = usage.cache_creation.ephemeral_5m_input_tokens;
        call.cache_write_1h_tokens = usage.cache_creation.ephemeral_1h_input_tokens;
        call.output_tokens = usage.output_tokens;
        call.reasoning_tokens = usage.output_tokens_details.thinking_tokens;
        if stop_reason.is_some() {
            call.stop_reason = stop_reason;
        }
    }
}

/// Fill each `tracepilot.model_call` placeholder with its call's final usage.
pub(super) fn fill_model_calls(
    events: &mut [RawEvent],
    placeholders: &HashMap<String, usize>,
    calls: &[ClaudeCallUsage],
) {
    for call in calls {
        let Some(event) = placeholders
            .get(&call.message_id)
            .and_then(|&index| events.get_mut(index))
        else {
            continue;
        };
        let by_ttl: BTreeMap<&str, u64> = [
            ("300", call.cache_write_5m_tokens),
            ("3600", call.cache_write_1h_tokens),
        ]
        .into_iter()
        .filter(|(_, tokens)| *tokens > 0)
        .collect();
        let usage = serde_json::json!({
            "model": call.model,
            "inputTokens": call.inclusive_input(),
            "cacheReadTokens": call.cache_read_tokens,
            "cacheWriteTokens": call.cache_write_tokens,
            "cacheWriteByTtl": (!by_ttl.is_empty()).then_some(by_ttl),
            "outputTokens": call.output_tokens,
            "reasoningTokens": call.reasoning_tokens,
            "stopReason": call.stop_reason,
        });
        if let (Some(data), Value::Object(usage)) = (event.data.as_object_mut(), usage) {
            data.extend(usage.into_iter().filter(|(_, value)| !value.is_null()));
        }
    }
}
