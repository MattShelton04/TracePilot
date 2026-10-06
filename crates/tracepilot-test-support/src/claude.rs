//! Synthetic Claude Code transcripts.
//!
//! Shapes follow `docs/research/claude-code-integration/record-shapes.md`;
//! every id, path, text and number is invented. Never copy real transcripts
//! into fixtures: they contain emails, org ids and full system prompts.
//!
//! [`Transcript`] appends records with a chained `parentUuid` and a clock that
//! advances one second per record. [`write_session`] lays a main transcript
//! and its subagents out as Claude Code does.

// This module constructs test fixtures; an I/O failure must fail the test at setup.
#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};
use tempfile::TempDir;

pub const SESSION_ID: &str = "11111111-1111-4111-8111-111111111111";
pub const OPUS: &str = "claude-opus-5-5";
pub const HAIKU: &str = "claude-haiku-4-5-20251001";

/// One API call's usage, in Claude's categories (`input` excludes cache).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub output: u64,
    pub thinking: u64,
}

impl Usage {
    pub fn new(input: u64, cache_read: u64, cache_write_1h: u64, output: u64) -> Self {
        Self {
            input,
            cache_read,
            cache_write_1h,
            output,
            ..Self::default()
        }
    }

    fn wire(&self, output: u64) -> Value {
        json!({
            "input_tokens": self.input,
            "cache_read_input_tokens": self.cache_read,
            "cache_creation_input_tokens": self.cache_write_5m + self.cache_write_1h,
            "cache_creation": {
                "ephemeral_5m_input_tokens": self.cache_write_5m,
                "ephemeral_1h_input_tokens": self.cache_write_1h,
            },
            "output_tokens": output,
            "output_tokens_details": {"thinking_tokens": self.thinking},
            "service_tier": "standard",
        })
    }
}

/// A transcript under construction: the main file or one subagent file.
pub struct Transcript {
    agent_id: Option<String>,
    namespace: u32,
    seq: u64,
    clock_s: u64,
    next_at: Option<u64>,
    last_uuid: Option<String>,
    next_parent: Option<Option<String>>,
    prompt_id: Option<String>,
    prompts: u32,
    lines: Vec<Vec<u8>>,
    tail: Vec<u8>,
}

impl Transcript {
    /// The main transcript of [`SESSION_ID`].
    pub fn main() -> Self {
        Self::with_agent(None, 0)
    }

    /// A subagent transcript: `isSidechain: true` and `agentId` on every record.
    pub fn subagent(agent_id: &str, namespace: u32) -> Self {
        Self::with_agent(Some(agent_id.to_string()), namespace)
    }

    fn with_agent(agent_id: Option<String>, namespace: u32) -> Self {
        Self {
            agent_id,
            namespace,
            seq: 0,
            clock_s: 0,
            next_at: None,
            last_uuid: None,
            next_parent: None,
            prompt_id: None,
            prompts: 0,
            lines: Vec::new(),
            tail: Vec::new(),
        }
    }

    pub fn last_uuid(&self) -> Option<String> {
        self.last_uuid.clone()
    }

    /// Parent the next enveloped record on `parent` instead of the previous one.
    pub fn parent_next(&mut self, parent: Option<&str>) -> &mut Self {
        self.next_parent = Some(parent.map(str::to_string));
        self
    }

    /// Stamp the next record at `seconds` after the base time (may go backwards).
    pub fn at(&mut self, seconds: u64) -> &mut Self {
        self.next_at = Some(seconds);
        self
    }

    /// The uuid the record `ahead` records from now will get (1 = next).
    pub fn upcoming_uuid(&self, ahead: u64) -> String {
        format!(
            "{:08x}-0000-4000-8000-{:012x}",
            self.namespace,
            self.seq + ahead
        )
    }

    fn uuid(&mut self) -> String {
        self.seq += 1;
        format!("{:08x}-0000-4000-8000-{:012x}", self.namespace, self.seq)
    }

    fn timestamp(&mut self) -> String {
        let seconds = self.next_at.take().unwrap_or_else(|| {
            self.clock_s += 1;
            self.clock_s
        });
        format!(
            "2026-09-20T{:02}:{:02}:{:02}.000Z",
            10 + seconds / 3600,
            seconds / 60 % 60,
            seconds % 60
        )
    }

    /// Append an enveloped record (`user`, `assistant`, `system`,
    /// `attachment`) with `body` merged in. Returns its uuid.
    pub fn record(&mut self, kind: &str, body: Value) -> String {
        let uuid = self.uuid();
        let parent = self
            .next_parent
            .take()
            .unwrap_or_else(|| self.last_uuid.clone());
        let mut record = Map::new();
        record.insert("type".into(), json!(kind));
        record.insert("uuid".into(), json!(uuid));
        record.insert("parentUuid".into(), json!(parent));
        record.insert("isSidechain".into(), json!(self.agent_id.is_some()));
        record.insert("timestamp".into(), json!(self.timestamp()));
        record.insert("sessionId".into(), json!(SESSION_ID));
        record.insert("cwd".into(), json!("C:\\work\\demo"));
        record.insert("gitBranch".into(), json!("main"));
        record.insert("version".into(), json!("2.1.280"));
        record.insert("entrypoint".into(), json!("cli"));
        record.insert("userType".into(), json!("external"));
        if let Some(agent) = &self.agent_id {
            record.insert("agentId".into(), json!(agent));
        }
        if let Value::Object(body) = body {
            record.extend(body);
        }
        self.push(&Value::Object(record));
        self.last_uuid = Some(uuid.clone());
        uuid
    }

    /// Append a bookkeeping record (no envelope; `sessionId` added).
    pub fn bookkeeping(&mut self, mut body: Value) {
        if let Some(map) = body.as_object_mut() {
            map.insert("sessionId".into(), json!(SESSION_ID));
        }
        self.push(&body);
    }

    fn push(&mut self, value: &Value) {
        let line = serde_json::to_vec(value).expect("fixture JSON serializes");
        self.lines.push(line);
    }

    /// Append a line verbatim (for malformed-line fixtures).
    pub fn raw_line(&mut self, text: &str) {
        self.lines.push(text.as_bytes().to_vec());
    }

    /// End the file with `bytes` and no newline: a live file mid-append.
    pub fn partial_tail(&mut self, bytes: &[u8]) {
        self.tail = bytes.to_vec();
    }

    /// A human prompt; starts a new `promptId`.
    pub fn prompt(&mut self, text: &str) -> String {
        self.prompts += 1;
        let prompt_id = format!("22222222-2222-4222-8222-{:012x}", self.prompts);
        self.prompt_id = Some(prompt_id.clone());
        self.record(
            "user",
            json!({
                "promptId": prompt_id,
                "message": {"role": "user", "content": text},
                "origin": {"kind": "human"},
                "promptSource": "typed",
            }),
        )
    }

    /// Start a new `promptId` without writing a record, for prompts that are
    /// not plain human text (a typed slash command).
    pub fn next_prompt_id(&mut self) -> String {
        self.prompts += 1;
        let prompt_id = format!("22222222-2222-4222-8222-{:012x}", self.prompts);
        self.prompt_id = Some(prompt_id.clone());
        prompt_id
    }

    /// A `user` record in the current prompt with `body` merged in.
    pub fn user(&mut self, body: Value) -> String {
        let mut body = body;
        if let (Some(map), Some(prompt)) = (body.as_object_mut(), &self.prompt_id) {
            map.entry("promptId").or_insert(json!(prompt));
        }
        self.record("user", body)
    }

    /// An `isMeta` user record with string content.
    pub fn meta(&mut self, text: &str, origin: Option<Value>) -> String {
        let mut body = json!({"isMeta": true, "message": {"role": "user", "content": text}});
        if let Some(origin) = origin {
            body["origin"] = origin;
        }
        self.user(body)
    }

    /// One API call written as one record per block. `output_tokens` grows
    /// across the records and only the last one carries the final usage and
    /// `stop_reason`, as Claude Code writes them.
    pub fn call(
        &mut self,
        message_id: &str,
        model: &str,
        blocks: Vec<Value>,
        usage: Usage,
        stop_reason: &str,
    ) -> Vec<String> {
        let count = blocks.len() as u64;
        let mut uuids = Vec::new();
        for (index, block) in blocks.into_iter().enumerate() {
            let last = index as u64 + 1 == count;
            let output = if last {
                usage.output
            } else {
                usage.output * (index as u64 + 1) / (count + 1)
            };
            uuids.push(self.record(
                "assistant",
                json!({
                    "requestId": format!("req_{message_id}"),
                    "message": {
                        "id": message_id,
                        "model": model,
                        "role": "assistant",
                        "stop_reason": if last { json!(stop_reason) } else { Value::Null },
                        "content": [block],
                        "usage": usage.wire(output),
                    },
                }),
            ));
        }
        uuids
    }

    /// A `tool_result` for `tool_use_id`. An error result's `toolUseResult` is
    /// a plain string, as Claude Code writes it.
    pub fn tool_result(
        &mut self,
        tool_use_id: &str,
        content: Value,
        tool_use_result: Value,
        is_error: bool,
    ) -> String {
        self.user(json!({
            "message": {"role": "user", "content": [{
                "type": "tool_result", "tool_use_id": tool_use_id,
                "is_error": is_error, "content": content,
            }]},
            "toolUseResult": tool_use_result,
        }))
    }

    pub fn system(&mut self, subtype: &str, body: Value) -> String {
        let mut body = body;
        body["subtype"] = json!(subtype);
        self.record("system", body)
    }

    /// An automatic compaction boundary (`parentUuid: null`) with its logical parent.
    pub fn compact_boundary(&mut self, logical_parent: &str, pre: u64, post: u64) -> String {
        self.compact_boundary_with(logical_parent, "auto", pre, post)
    }

    /// A compaction boundary with its `trigger` (`auto` or `manual`).
    pub fn compact_boundary_with(
        &mut self,
        logical_parent: &str,
        trigger: &str,
        pre: u64,
        post: u64,
    ) -> String {
        self.parent_next(None);
        self.system(
            "compact_boundary",
            json!({
                "logicalParentUuid": logical_parent,
                "content": "Conversation compacted",
                "compactMetadata": {"trigger": trigger, "preTokens": pre, "postTokens": post,
                    "durationMs": 5000},
            }),
        )
    }

    /// A `cost-state` snapshot: `(model, usage, costUSD)` per model.
    pub fn cost_state(&mut self, models: &[(&str, Usage, f64)]) {
        let mut usage = Map::new();
        let mut total = 0.0;
        for (model, u, cost) in models {
            total += cost;
            usage.insert(
                (*model).to_string(),
                json!({
                    "inputTokens": u.input, "outputTokens": u.output,
                    "thinkingTokens": u.thinking, "cacheReadInputTokens": u.cache_read,
                    "cacheCreationInputTokens": u.cache_write_5m + u.cache_write_1h,
                    "webSearchRequests": 0, "costUSD": cost,
                }),
            );
        }
        self.bookkeeping(json!({
            "type": "cost-state", "totalCostUSD": total, "totalAPIDuration": 60000,
            "totalDuration": 120000, "totalLinesAdded": 3, "totalLinesRemoved": 1,
            "modelUsage": usage,
        }));
    }

    /// The file contents.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for line in &self.lines {
            out.extend_from_slice(line);
            out.push(b'\n');
        }
        out.extend_from_slice(&self.tail);
        out
    }
}

pub fn text(text: &str) -> Value {
    json!({"type": "text", "text": text})
}

pub fn thinking(text: &str) -> Value {
    json!({"type": "thinking", "thinking": text, "signature": "c2lnbmF0dXJl"})
}

pub fn tool_use(id: &str, name: &str, input: Value) -> Value {
    json!({"type": "tool_use", "id": id, "name": name, "input": input,
        "caller": {"type": "direct"}})
}

pub fn image(base64: &str) -> Value {
    json!({"type": "image", "source": {"type": "base64", "media_type": "image/png",
        "data": base64}})
}

/// A `<task-notification>` block; `tokens` adds a `<usage>` section.
pub fn task_notification(
    task_id: &str,
    tool_use_id: &str,
    status: &str,
    tokens: Option<u64>,
) -> String {
    let usage = tokens.map_or(String::new(), |t| {
        format!("<usage><subagent_tokens>{t}</subagent_tokens><tool_uses>3</tool_uses><duration_ms>9000</duration_ms></usage>\n")
    });
    format!(
        "<task-notification>\n<task-id>{task_id}</task-id>\n<tool-use-id>{tool_use_id}</tool-use-id>\n\
         <status>{status}</status>\n<summary>Agent \"demo\" finished</summary>\n{usage}</task-notification>"
    )
}

/// `agent-<id>.meta.json` content.
pub fn subagent_meta(tool_use_id: &str, agent_type: &str, depth: u64) -> Value {
    json!({"agentType": agent_type, "description": "Map the indexer", "toolUseId": tool_use_id,
        "spawnDepth": depth, "requestShape": "background"})
}

/// A subagent file to write next to the main transcript.
pub struct Subagent<'a> {
    pub agent_id: &'a str,
    pub transcript: &'a Transcript,
    /// `None` writes no `meta.json`.
    pub meta: Option<Value>,
}

/// A written session: `<root>/projects/C--work-demo/<SESSION_ID>.jsonl`.
pub struct SessionFiles {
    pub root: TempDir,
    pub main: PathBuf,
}

/// `<config>/sessions/<pid>.json`, which Claude Code writes while a process
/// runs. `proc_start` is the process start time it recorded.
pub fn write_pid_file(
    config_dir: &Path,
    pid: u32,
    session_id: &str,
    proc_start: &str,
    status: &str,
) {
    let dir = config_dir.join("sessions");
    fs::create_dir_all(&dir).expect("create sessions dir");
    let record = json!({"pid": pid, "sessionId": session_id, "cwd": "C:\\work\\demo",
        "startedAt": 1_790_000_000_000_u64, "procStart": proc_start, "version": "2.1.289",
        "kind": "interactive", "entrypoint": "cli", "status": status,
        "updatedAt": 1_790_000_300_000_u64});
    fs::write(dir.join(format!("{pid}.json")), record.to_string()).expect("write pid file");
}

pub fn write_session(main: &Transcript, subagents: &[Subagent<'_>]) -> SessionFiles {
    let root = tempfile::tempdir().expect("temp dir");
    let project = root.path().join("projects").join("C--work-demo");
    let subagent_dir = project.join(SESSION_ID).join("subagents");
    fs::create_dir_all(&subagent_dir).expect("create subagents dir");
    let main_path = project.join(format!("{SESSION_ID}.jsonl"));
    fs::write(&main_path, main.to_bytes()).expect("write main transcript");
    for agent in subagents {
        let path = subagent_dir.join(format!("agent-{}.jsonl", agent.agent_id));
        fs::write(&path, agent.transcript.to_bytes()).expect("write subagent transcript");
        if let Some(meta) = &agent.meta {
            let meta_path = subagent_dir.join(format!("agent-{}.meta.json", agent.agent_id));
            fs::write(meta_path, meta.to_string()).expect("write subagent meta");
        }
    }
    SessionFiles {
        root,
        main: main_path,
    }
}
