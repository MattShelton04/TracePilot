//! The requests Claude Code recorded (2.1.301+), read on demand for the
//! Context tab's "Recorded requests" view (record-shapes.md, "Request
//! records").
//!
//! Only lines holding `"api-request` are parsed, in the main transcript and
//! each subagent file. `api-request-shape` records give each distinct system
//! prompt and tool list once; `api-request` records give one model call's
//! parameters and the shape it used. `api-request-blob` messages are counted,
//! never kept: their hashes do not reliably rebuild a request's messages.
//! This is what Claude Code chose to record, not a capture of the wire
//! request.

use std::collections::{BTreeMap, HashMap};
use std::io::BufReader;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::reader::{MAX_LINE_BYTES, read_line_bounded};
use super::request_records::MARKER;
use super::subagents;
use crate::context_capture::{
    CaptureProtocol, NormalizedSection, NormalizedToolDefinition, parse_context_request,
};
use crate::error::{Result, TracePilotError};
use crate::parsing::events::parse_json_line_lenient;
use crate::parsing::snapshot::check_cancelled;

/// Shapes returned with their bodies. A real session has a handful; each
/// is up to ~100 KB of system prompt and tool definitions.
pub const MAX_RECORDED_SHAPES: usize = 24;
/// Calls returned, the latest ones. A long session records a few thousand.
pub const MAX_RECORDED_CALLS: usize = 2_000;
/// Beta and context-edit names kept per call.
const MAX_NAMES: usize = 16;

/// What Claude Code recorded of a session's API requests.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    /// Distinct system prompt and tool sets, by first use.
    pub shapes: Vec<RecordedShape>,
    /// Shapes left out past [`MAX_RECORDED_SHAPES`].
    pub omitted_shapes: usize,
    /// The latest [`MAX_RECORDED_CALLS`] calls, oldest first.
    pub calls: Vec<RecordedCall>,
    pub total_calls: usize,
    /// Calls whose shape record was not found in the session's files.
    pub calls_without_shape: usize,
    /// Calls per model, most used first.
    pub models: Vec<RecordedCount>,
    /// Calls per agent: the main agent first, then subagents by first call.
    pub agents: Vec<RecordedAgent>,
    /// Request records of every type read.
    pub records: usize,
    /// Lines that looked like request records but could not be read.
    pub unreadable_records: usize,
    /// Files read: the main transcript plus each subagent file.
    pub files: usize,
}

/// One distinct system prompt and tool list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedShape {
    /// Claude Code's `shapeHash`.
    pub hash: String,
    /// The first call that used it, else when the shape was recorded.
    pub first_used: Option<DateTime<Utc>>,
    pub calls: usize,
    /// Who used it, with their call counts.
    pub agents: Vec<RecordedAgent>,
    pub system: Vec<NormalizedSection>,
    pub tools: Vec<NormalizedToolDefinition>,
    pub system_bytes: u64,
    pub tool_bytes: u64,
}

/// The main agent (`agent_id: None`) or one subagent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAgent {
    pub agent_id: Option<String>,
    /// The subagent's type from its `meta.json`.
    pub agent_type: Option<String>,
    pub calls: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedCount {
    pub name: String,
    pub calls: usize,
}

/// One recorded model call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedCall {
    pub timestamp: Option<DateTime<Utc>>,
    pub model: Option<String>,
    /// What made the call, such as `repl_main_thread` or `agent:builtin:…`.
    pub query_source: Option<String>,
    pub agent_id: Option<String>,
    pub agent_type: Option<String>,
    pub shape_hash: Option<String>,
    pub max_tokens: Option<u64>,
    /// The thinking mode (`params.thinking.type`).
    pub thinking: Option<String>,
    pub effort: Option<String>,
    pub betas: Vec<String>,
    /// Context-management edit types.
    pub context_edits: Vec<String>,
    /// Prompt-cache breakpoints (`cacheControl` entries).
    pub cache_breakpoints: usize,
    /// The request extends an earlier one (`base`).
    pub extends_previous: bool,
}

#[derive(Deserialize)]
struct Head {
    #[serde(rename = "type")]
    kind: Option<Value>,
}

/// One file's agent.
struct Agent {
    id: Option<String>,
    kind: Option<String>,
}

#[derive(Default)]
struct Scan {
    shapes: Vec<(String, Option<DateTime<Utc>>, Value)>,
    calls: Vec<RecordedCall>,
    records: usize,
    unreadable: usize,
}

/// Read the request records of the session whose main transcript is `main`.
/// A session from before Claude Code 2.1.301 has none.
pub fn read_request_log(main: &Path, is_cancelled: &impl Fn() -> bool) -> Result<RequestLog> {
    let mut scan = Scan::default();
    let main_agent = Agent {
        id: None,
        kind: None,
    };
    scan_file(main, &main_agent, is_cancelled, &mut scan)?;
    let children = subagents::files(main);
    for child in &children {
        let agent = Agent {
            id: Some(child.agent_id.clone()),
            kind: child.meta.as_ref().and_then(|m| m.agent_type.clone()),
        };
        scan_file(&child.path, &agent, is_cancelled, &mut scan)?;
    }
    Ok(build(scan, children.len() + 1))
}

fn scan_file(
    path: &Path,
    agent: &Agent,
    is_cancelled: &impl Fn() -> bool,
    scan: &mut Scan,
) -> Result<()> {
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut bytes = Vec::new();
    loop {
        check_cancelled(is_cancelled)?;
        bytes.clear();
        let read = read_line_bounded(&mut reader, &mut bytes, MAX_LINE_BYTES, is_cancelled)?;
        if read.consumed == 0 {
            return Ok(());
        }
        let Some(text) = std::str::from_utf8(&bytes).ok().map(str::trim) else {
            continue;
        };
        if read.oversized || !text.contains(MARKER) {
            continue;
        }
        let Ok(head) = parse_json_line_lenient::<Head>(text) else {
            // A cut-off request record (a live file's last line).
            if text.contains("\"type\":\"api-request") {
                scan.unreadable += 1;
            }
            continue;
        };
        match head.kind.as_ref().and_then(Value::as_str) {
            Some("api-request-blob") => scan.records += 1,
            Some(kind @ ("api-request" | "api-request-shape")) => {
                scan.records += 1;
                let Ok(record) = parse_json_line_lenient::<Value>(text) else {
                    scan.unreadable += 1;
                    continue;
                };
                if kind == "api-request" {
                    scan.calls.push(call(&record, agent));
                } else if let Some(hash) = str_at(&record, "/shapeHash") {
                    let at = timestamp(&record);
                    let shape = record.get("shape").cloned().unwrap_or(Value::Null);
                    scan.shapes.push((hash, at, shape));
                }
            }
            _ => {}
        }
    }
}

fn str_at(value: &Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn timestamp(record: &Value) -> Option<DateTime<Utc>> {
    record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
        .map(|ts| ts.with_timezone(&Utc))
}

fn names(value: Option<&Value>, pick: impl Fn(&Value) -> Option<&str>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(pick)
        .take(MAX_NAMES)
        .map(|name| name.chars().take(80).collect())
        .collect()
}

/// The call's identifying parameters; `params.safeguards`, which holds the
/// safety classifier's context, is never read.
fn call(record: &Value, agent: &Agent) -> RecordedCall {
    let params = record.get("params");
    let param = |pointer: &str| params.and_then(|p| p.pointer(pointer));
    RecordedCall {
        timestamp: timestamp(record),
        model: param("/model").and_then(Value::as_str).map(str::to_string),
        query_source: str_at(record, "/querySource"),
        agent_id: agent.id.clone().or_else(|| str_at(record, "/agentId")),
        agent_type: agent.kind.clone(),
        shape_hash: str_at(record, "/shapeHash"),
        max_tokens: param("/max_tokens").and_then(Value::as_u64),
        thinking: param("/thinking/type")
            .and_then(Value::as_str)
            .map(str::to_string),
        effort: param("/output_config/effort")
            .and_then(Value::as_str)
            .map(str::to_string),
        betas: names(param("/betas"), Value::as_str),
        context_edits: names(param("/context_management/edits"), |edit| {
            edit.get("type").and_then(Value::as_str)
        }),
        cache_breakpoints: record
            .get("cacheControl")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        extends_previous: record.get("base").is_some_and(|base| !base.is_null()),
    }
}

/// Usage of one shape.
#[derive(Default)]
struct Usage {
    calls: usize,
    first_used: Option<DateTime<Utc>>,
    agents: Vec<RecordedAgent>,
}

fn count_agent(agents: &mut Vec<RecordedAgent>, call: &RecordedCall) {
    match agents.iter_mut().find(|a| a.agent_id == call.agent_id) {
        Some(agent) => agent.calls += 1,
        None => agents.push(RecordedAgent {
            agent_id: call.agent_id.clone(),
            agent_type: call.agent_type.clone(),
            calls: 1,
        }),
    }
}

fn build(mut scan: Scan, files: usize) -> RequestLog {
    // Files are read one after another; order the calls by time.
    scan.calls.sort_by_key(|call| call.timestamp);
    let mut usage: HashMap<&str, Usage> = HashMap::new();
    let mut models: BTreeMap<&str, usize> = BTreeMap::new();
    let mut agents = Vec::new();
    for call in &scan.calls {
        count_agent(&mut agents, call);
        if let Some(model) = &call.model {
            *models.entry(model).or_default() += 1;
        }
        if let Some(hash) = &call.shape_hash {
            let entry = usage.entry(hash).or_default();
            entry.calls += 1;
            entry.first_used = entry.first_used.or(call.timestamp);
            count_agent(&mut entry.agents, call);
        }
    }
    // The main agent leads; subagents follow by first call.
    agents.sort_by_key(|agent| agent.agent_id.is_some());
    let mut seen = HashMap::new();
    let mut shapes: Vec<RecordedShape> = Vec::new();
    for (hash, recorded_at, body) in scan.shapes {
        if seen.insert(hash.clone(), ()).is_some() {
            continue;
        }
        let used = usage.remove(hash.as_str()).unwrap_or_default();
        shapes.push(shape(hash, used, recorded_at, &body));
    }
    let calls_without_shape = usage.values().map(|u| u.calls).sum();
    shapes.sort_by_key(|shape| shape.first_used);
    let omitted_shapes = shapes.len().saturating_sub(MAX_RECORDED_SHAPES);
    shapes.truncate(MAX_RECORDED_SHAPES);
    let mut models: Vec<_> = models
        .into_iter()
        .map(|(name, calls)| RecordedCount {
            name: name.to_string(),
            calls,
        })
        .collect();
    models.sort_by_key(|model| std::cmp::Reverse(model.calls));
    let total_calls = scan.calls.len();
    let calls = scan
        .calls
        .split_off(total_calls.saturating_sub(MAX_RECORDED_CALLS));
    RequestLog {
        shapes,
        omitted_shapes,
        calls,
        total_calls,
        calls_without_shape,
        models,
        agents,
        records: scan.records,
        unreadable_records: scan.unreadable,
        files,
    }
}

fn shape(
    hash: String,
    used: Usage,
    recorded_at: Option<DateTime<Utc>>,
    body: &Value,
) -> RecordedShape {
    // The shape is an Anthropic Messages request without its messages.
    let request = json!({"system": body.get("system"), "tools": body.get("tools")});
    let parsed = serde_json::to_vec(&request).ok().and_then(|bytes| {
        parse_context_request(CaptureProtocol::AnthropicMessages, &bytes, "\u{0}").ok()
    });
    let (mut system, tools) = parsed.map_or_else(
        || (Vec::new(), Vec::new()),
        |p| (p.system_blocks, p.tool_definitions),
    );
    // A missing system prompt parses to one `null` block.
    system.retain(|block| !block.content.is_null());
    for block in &mut system {
        block.contains_probe = false;
        // A text block reads as its text; its size stays the block's.
        if block.content["type"] == "text"
            && let Some(text) = block.content["text"].as_str()
        {
            block.content = Value::String(text.to_string());
        }
    }
    let system_bytes = system.iter().map(|block| block.bytes).sum();
    let tool_bytes = tools.iter().map(|tool| tool.bytes).sum();
    RecordedShape {
        hash,
        first_used: used.first_used.or(recorded_at),
        calls: used.calls,
        agents: used.agents,
        system,
        tools,
        system_bytes,
        tool_bytes,
    }
}
