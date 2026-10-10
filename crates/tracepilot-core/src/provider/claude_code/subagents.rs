//! Subagent files: `<session>/subagents/agent-<agentId>.jsonl` + `.meta.json`.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::ClaudeDiagnostics;
use super::reader::{Line, read_jsonl};
use super::records::{Rec, SubagentMeta, block_type};
use super::tools;
use crate::error::Result;

/// One subagent transcript.
pub(super) struct ChildStream {
    pub(super) agent_id: String,
    /// `None` when `meta.json` is missing or unreadable.
    pub(super) meta: Option<SubagentMeta>,
    pub(super) lines: Vec<Line>,
}

impl ChildStream {
    pub(super) fn first_timestamp(&self) -> Option<DateTime<Utc>> {
        self.lines
            .iter()
            .find_map(|line| Rec(&line.value).timestamp())
    }
}

/// Load every subagent of the session at `main`, sorted by agent id. A
/// session without a `subagents/` directory has none.
pub(super) fn load(
    main: &Path,
    is_cancelled: &impl Fn() -> bool,
    diagnostics: &mut ClaudeDiagnostics,
) -> Result<Vec<ChildStream>> {
    let dir = main.with_extension("").join("subagents");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut paths: Vec<_> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    paths.sort();
    let mut children = Vec::new();
    for path in paths {
        let Some(agent_id) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(|stem| stem.strip_prefix("agent-"))
            .map(str::to_string)
        else {
            continue;
        };
        let meta = std::fs::read(path.with_extension("meta.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SubagentMeta>(&bytes).ok());
        let lines = read_jsonl(&path, is_cancelled, diagnostics)?;
        children.push(ChildStream {
            agent_id,
            meta,
            lines,
        });
    }
    Ok(children)
}

/// How subagents attach to the calls that launched them (mapping.md §1.3).
pub(super) struct Links {
    /// Agent id → launching `tool_use` id.
    pub(super) agent_owner: HashMap<String, String>,
    /// Ids of every `Agent` `tool_use`.
    pub(super) agent_tool_ids: HashSet<String>,
    /// Launching `tool_use` id → child indices, by first timestamp then agent id.
    pub(super) launches: HashMap<String, Vec<usize>>,
    /// Agent id → the main-file `SendMessage` calls that resumed it, as
    /// (when the call was made, its line).
    pub(super) resumes: HashMap<String, Vec<(DateTime<Utc>, usize)>>,
}

/// Link each child to its launching call: `meta.json`'s `toolUseId`, else
/// the `agentId` in that call's `Agent` result. Children with neither are
/// left out of `launches` (orphans).
pub(super) fn link(main: &[Line], children: &[ChildStream]) -> Links {
    let streams = std::iter::once(main).chain(children.iter().map(|c| c.lines.as_slice()));
    let mut agent_owner = HashMap::new();
    let mut agent_tool_ids = HashSet::new();
    for line in streams.flatten() {
        let rec = Rec(&line.value);
        let blocks = rec.0.pointer("/message/content").and_then(Value::as_array);
        for block in blocks.into_iter().flatten() {
            let id = block.get("id").and_then(Value::as_str);
            let name = block.get("name").and_then(Value::as_str);
            if let (Some(id), Some(name)) = (id, name)
                && tools::is_agent_tool(name)
            {
                agent_tool_ids.insert(id.to_string());
            }
            if block_type(block) == "tool_result"
                && let (Some(tool_id), Some(agent)) = (
                    block.get("tool_use_id").and_then(Value::as_str),
                    rec.ptr_str("/toolUseResult/agentId"),
                )
            {
                agent_owner.insert(agent.to_string(), tool_id.to_string());
            }
        }
    }
    for child in children {
        if let Some(tool) = child.meta.as_ref().and_then(|m| m.tool_use_id.clone()) {
            agent_owner.insert(child.agent_id.clone(), tool);
        }
    }
    let mut launches: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, child) in children.iter().enumerate() {
        if let Some(tool) = agent_owner.get(&child.agent_id) {
            launches.entry(tool.clone()).or_default().push(index);
        }
    }
    for list in launches.values_mut() {
        list.sort_by(|a, b| {
            let (a, b) = (&children[*a], &children[*b]);
            (a.first_timestamp(), &a.agent_id).cmp(&(b.first_timestamp(), &b.agent_id))
        });
    }
    Links {
        agent_owner,
        agent_tool_ids,
        launches,
        resumes: resumes(main),
    }
}

/// Each main-file `SendMessage` whose result resumed a finished agent
/// (`resumedAgentId`), by agent: when and where the call was made. A resumed
/// agent's later records are in its own file, after its first run's.
///
/// A record with several results shares one `toolUseResult`, which names
/// one agent at most, so each of its `SendMessage`s counts for the agent its
/// input names (`to`). Taking a message to a running agent as a resume is
/// harmless: that agent was launched in the same run, so no snapshot lies
/// between its launch and the message.
fn resumes(main: &[Line]) -> HashMap<String, Vec<(DateTime<Utc>, usize)>> {
    // `SendMessage` id → when, its line, and the agent its input names.
    type Send<'a> = (Option<DateTime<Utc>>, usize, Option<&'a str>);
    let mut sends: HashMap<&str, Send<'_>> = HashMap::new();
    let mut resumes: HashMap<String, Vec<(DateTime<Utc>, usize)>> = HashMap::new();
    for line in main {
        let rec = Rec(&line.value);
        let blocks = rec.0.pointer("/message/content").and_then(Value::as_array);
        let blocks = blocks.map_or(&[][..], Vec::as_slice);
        let results = blocks
            .iter()
            .filter(|b| block_type(b) == "tool_result")
            .count();
        for block in blocks {
            if block.get("name").and_then(Value::as_str) == Some("SendMessage")
                && let Some(id) = block.get("id").and_then(Value::as_str)
            {
                let to = block.pointer("/input/to").and_then(Value::as_str);
                sends.insert(id, (rec.timestamp(), line.line, to));
            }
            if block_type(block) != "tool_result"
                || block.get("is_error").and_then(Value::as_bool) == Some(true)
            {
                continue;
            }
            let Some(&(Some(at), call_line, to)) = block
                .get("tool_use_id")
                .and_then(Value::as_str)
                .and_then(|tool| sends.get(tool))
            else {
                continue;
            };
            let agent = if results == 1 {
                rec.ptr_str("/toolUseResult/resumedAgentId")
            } else {
                to
            };
            if let Some(agent) = agent {
                resumes
                    .entry(agent.to_string())
                    .or_default()
                    .push((at, call_line));
            }
        }
    }
    resumes
}
