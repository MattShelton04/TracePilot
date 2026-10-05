// Diagnostic probe: fails fast on setup errors and prints its report.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::print_stderr
)]
//! S3 real-data probe for the Claude Code parser (implementation-plan.md L0).
//!
//! `#[ignore]`d and gated on `TRACEPILOT_CLAUDE_PROBE_DIR`, so `cargo test`
//! never reads real data. Point it at a Claude config dir (or its `projects/`):
//!
//! ```powershell
//! $env:TRACEPILOT_CLAUDE_PROBE_DIR = "$HOME\.claude"
//! cargo test -p tracepilot-core --test claude_code_probe -- --ignored --nocapture
//! ```
//!
//! It is read-only and reads only `projects/<slug>/<uuid>.jsonl` and their
//! `subagents/` (never `sessions/`). It prints **aggregate counts only**: no
//! content, paths, session ids or project names. Sessions are numbered by
//! discovery order. It fails if a usage residual is negative or a
//! serialize → parse → reconstruct round trip changes the turns, since both
//! are parser bugs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::Value;
use tracepilot_core::models::ConversationTurn;
use tracepilot_core::parsing::events::{RawEvent, events_to_jsonl, parse_typed_events};
use tracepilot_core::provider::claude_code::{
    ClaudeParse, CostModelUsage, TokenTotals, parse_claude_session, sum_calls_by_model,
};
use tracepilot_core::reconstruct_turns;

#[test]
#[ignore = "reads real Claude Code transcripts; set TRACEPILOT_CLAUDE_PROBE_DIR"]
fn claude_code_probe_reports_aggregates() {
    let Some(dir) = std::env::var_os("TRACEPILOT_CLAUDE_PROBE_DIR").map(PathBuf::from) else {
        eprintln!("TRACEPILOT_CLAUDE_PROBE_DIR not set; skipping");
        return;
    };
    let projects = if dir.join("projects").is_dir() {
        dir.join("projects")
    } else {
        dir
    };
    let mut report = Report::default();
    for (ordinal, path) in discover(&projects).iter().enumerate() {
        report.add(ordinal + 1, path);
    }
    report.print();
    assert_eq!(report.residuals.get("negative").copied().unwrap_or(0), 0);
    assert_eq!(report.round_trip_mismatches, 0);
}

fn discover(projects: &Path) -> Vec<PathBuf> {
    let mut sessions = Vec::new();
    for project in std::fs::read_dir(projects)
        .expect("read projects dir")
        .flatten()
    {
        let path = project.path();
        if !path.is_dir() || path.file_name().is_some_and(|n| n == "memory") {
            continue;
        }
        for file in std::fs::read_dir(&path).into_iter().flatten().flatten() {
            let file = file.path();
            if file.is_file() && file.extension().is_some_and(|e| e == "jsonl") {
                sessions.push(file);
            }
        }
    }
    sessions.sort();
    sessions
}

const CATEGORIES: [&str; 4] = ["input", "cacheRead", "cacheWrite", "output"];

#[derive(Default)]
struct Report {
    sessions: usize,
    parse_errors: usize,
    round_trip_mismatches: usize,
    parse_time: Duration,
    slowest: Duration,
    events: usize,
    canonical_events: BTreeMap<String, usize>,
    unknown_events: usize,
    counters: BTreeMap<&'static str, usize>,
    unknown_record_types: BTreeMap<String, usize>,
    unknown_attachment_types: BTreeMap<String, usize>,
    // Turns
    turns: usize,
    prompts: usize,
    system_turns: usize,
    incomplete_not_last: usize,
    turns_per_prompt: Vec<usize>,
    tool_only_turns: usize,
    subagent_calls: usize,
    subagent_calls_complete: usize,
    agent_messages_attached: usize,
    // Usage
    calls: usize,
    abandoned_calls: usize,
    calls_by_model: BTreeMap<String, usize>,
    with_snapshot: usize,
    without_snapshot: usize,
    resumed: usize,
    with_tail: usize,
    tail_calls: usize,
    /// model → category → (transcript covered by the last snapshot, snapshot).
    coverage: BTreeMap<String, [(u64, u64); 4]>,
    residuals: BTreeMap<&'static str, usize>,
    /// Residual class -> (session x model rows, rows whose session has an
    /// away summary, distinct titles summed over rows).
    class_correlates: BTreeMap<&'static str, (usize, usize, usize)>,
    interrupts: BTreeMap<&'static str, usize>,
    incomplete_causes: BTreeMap<&'static str, usize>,
    unexplained: Vec<String>,
    // Tool rendering inputs
    tools: BTreeMap<&'static str, usize>,
}

impl Report {
    fn count(&mut self, key: &'static str, n: usize) {
        *self.counters.entry(key).or_default() += n;
    }

    fn add(&mut self, ordinal: usize, path: &Path) {
        self.sessions += 1;
        let start = Instant::now();
        let Ok(parsed) = parse_claude_session(path, &|| false) else {
            self.parse_errors += 1;
            return;
        };
        let turns = reconstruct_turns(&parsed.events);
        let elapsed = start.elapsed();
        self.parse_time += elapsed;
        self.slowest = self.slowest.max(elapsed);
        if !round_trip_matches(&parsed, &turns) {
            self.round_trip_mismatches += 1;
        }
        self.add_events(&parsed);
        self.add_turns(&turns);
        self.add_usage(ordinal, &parsed);
        self.add_tools(&parsed);
        self.add_interrupts(&parsed);
    }

    fn add_interrupts(&mut self, parsed: &ClaudeParse) {
        for event in &parsed.events {
            let Some(native) = &event.raw.native else {
                continue;
            };
            let has_id = native.data.get("interruptedMessageId").is_some();
            let key = match (event.raw.event_type.as_str(), has_id) {
                ("abort", true) => "abort from a record with interruptedMessageId",
                ("abort", false) => "abort from an interrupt marker text",
                ("user.message", true) => "user.message from a record with interruptedMessageId",
                _ => continue,
            };
            *self.interrupts.entry(key).or_default() += 1;
        }
    }

    fn add_events(&mut self, parsed: &ClaudeParse) {
        self.events += parsed.events.len();
        for event in &parsed.events {
            let kind = &event.raw.event_type;
            if kind.contains('.') {
                *self.canonical_events.entry(kind.clone()).or_default() += 1;
            } else {
                self.unknown_events += 1;
            }
        }
        let d = &parsed.diagnostics;
        for (key, n) in [
            ("malformed lines", d.malformed_lines),
            ("partial tails", d.partial_tails),
            ("redacted thinking", d.redacted_thinking),
            ("orphan subagents", d.orphan_subagents),
            ("duplicate notifications", d.duplicate_notifications),
            ("missing tool results", d.missing_tool_results),
            ("abandoned records", d.abandoned_records),
            ("parent-walk cycles", d.parent_cycles),
            ("sanitized images", d.sanitized_images),
            ("persisted outputs", d.persisted_outputs),
            ("cost-state records", d.cost_state_records),
            (
                "typed-data fallbacks (excl. unknown)",
                d.events
                    .deserialization_failures
                    .values()
                    .map(|f| f.count)
                    .sum(),
            ),
        ] {
            self.count(key, n);
        }
        for (name, n) in &d.unknown_record_types {
            *self.unknown_record_types.entry(name.clone()).or_default() += n;
        }
        for (name, n) in &d.unknown_attachment_types {
            *self
                .unknown_attachment_types
                .entry(name.clone())
                .or_default() += n;
        }
        if parsed.events.iter().any(|e| e.raw.agent_id.is_some()) {
            self.count("sessions with subagents", 1);
        }
        if parsed
            .events
            .iter()
            .any(|e| e.raw.event_type == "session.compaction_complete")
        {
            self.count("sessions with compaction", 1);
        }
        if d.abandoned_records > 0 {
            self.count("sessions with forks", 1);
        }
    }

    fn add_turns(&mut self, turns: &[ConversationTurn]) {
        self.turns += turns.len();
        let mut current: Option<usize> = None;
        for (index, turn) in turns.iter().enumerate() {
            if turn.user_message.is_some() {
                if turn.system_initiated {
                    self.system_turns += 1;
                } else {
                    self.prompts += 1;
                }
                if let Some(n) = current.replace(1) {
                    self.turns_per_prompt.push(n);
                }
            } else if let Some(n) = current.as_mut() {
                *n += 1;
            }
            if !turn.is_complete && index + 1 < turns.len() {
                self.incomplete_not_last += 1;
                let message = turn.user_message.as_deref().unwrap_or("").trim_start();
                let cause = if message.starts_with("<command-")
                    || message.starts_with("<local-command-stdout>")
                {
                    "slash command (no model call)"
                } else if message.starts_with("<bash-") {
                    "bash mode (no model call)"
                } else if turn
                    .session_events
                    .iter()
                    .any(|e| e.event_type == "session.error")
                {
                    "session.error (no model call)"
                } else if turn.turn_id.is_some() {
                    "call ended by abort"
                } else if turn.user_message.is_some() {
                    "prompt with no model call"
                } else {
                    "other"
                };
                *self.incomplete_causes.entry(cause).or_default() += 1;
            }
            let main_text = turn
                .assistant_messages
                .iter()
                .any(|m| m.parent_tool_call_id.is_none());
            if !main_text && !turn.tool_calls.is_empty() {
                self.tool_only_turns += 1;
            }
            for call in turn.tool_calls.iter().filter(|c| c.is_subagent) {
                self.subagent_calls += 1;
                self.subagent_calls_complete += usize::from(call.is_complete);
            }
            self.agent_messages_attached += turn
                .assistant_messages
                .iter()
                .filter(|m| m.parent_tool_call_id.is_some())
                .count();
        }
        if let Some(n) = current {
            self.turns_per_prompt.push(n);
        }
    }

    fn add_usage(&mut self, ordinal: usize, parsed: &ClaudeParse) {
        self.calls += parsed.calls.len();
        self.abandoned_calls += parsed.calls.iter().filter(|c| c.abandoned).count();
        for call in &parsed.calls {
            *self
                .calls_by_model
                .entry(call.model.clone().unwrap_or_default())
                .or_default() += 1;
        }
        let tail = parsed.tail_calls().count();
        self.tail_calls += tail;
        self.with_tail += usize::from(tail > 0);
        if parsed.cost_snapshots.len() > 1 {
            self.resumed += 1;
        }
        let Some(snapshot) = parsed.cost_snapshots.last() else {
            self.without_snapshot += 1;
            return;
        };
        self.with_snapshot += 1;
        let compaction = parsed
            .events
            .iter()
            .any(|e| e.raw.event_type == "session.compaction_complete");
        let covered = sum_calls_by_model(
            parsed
                .calls
                .iter()
                .filter(|c| c.snapshot_anchor.is_some_and(|a| a < snapshot.line)),
        );
        let mut models: Vec<&String> = snapshot.model_usage.keys().chain(covered.keys()).collect();
        models.sort();
        models.dedup();
        for model in models {
            let snap = snapshot.model_usage.get(model).cloned().unwrap_or_default();
            let tr = covered.get(model).copied().unwrap_or_default();
            let pairs = category_pairs(&tr, &snap);
            let entry = self.coverage.entry(model.clone()).or_default();
            for (slot, pair) in entry.iter_mut().zip(pairs) {
                slot.0 += pair.0;
                slot.1 += pair.1;
            }
            let class = if pairs.iter().any(|(t, s)| t > s) {
                "negative"
            } else if tr.calls == 0 {
                "sideModel"
            } else if pairs.iter().all(|(t, s)| t == s) {
                "exact"
            } else if compaction {
                "compaction"
            } else {
                "unexplained"
            };
            *self.residuals.entry(class).or_default() += 1;
            let (away, titles) = side_call_correlates(parsed);
            let entry = self.class_correlates.entry(class).or_default();
            entry.0 += 1;
            entry.1 += usize::from(away > 0);
            entry.2 += titles;
            if matches!(class, "unexplained" | "negative") {
                let detail: Vec<String> = CATEGORIES
                    .iter()
                    .zip(pairs)
                    .map(|(name, (t, s))| format!("{name} {}", s as i128 - t as i128))
                    .collect();
                let d = &parsed.diagnostics;
                self.unexplained.push(format!(
                    "#{ordinal} {class} {model}: residual {} | snapshots {}, tail calls {}, \
                     orphans {}, abandoned calls {}, subagent calls {}, away summaries {away}, distinct titles {titles}",
                    detail.join(", "),
                    parsed.cost_snapshots.len(),
                    parsed.tail_calls().count(),
                    d.orphan_subagents,
                    parsed.calls.iter().filter(|c| c.abandoned).count(),
                    parsed.calls.iter().filter(|c| c.agent_id.is_some()).count(),
                ));
            }
        }
    }

    fn add_tools(&mut self, parsed: &ClaudeParse) {
        let mut native_names = BTreeMap::new();
        for event in &parsed.events {
            if event.raw.event_type == "tool.execution_start"
                && let (Some(id), Some(name)) = (
                    event.raw.data["toolCallId"].as_str(),
                    event.raw.data["nativeToolName"].as_str(),
                )
            {
                native_names.insert(id.to_string(), name.to_string());
            }
        }
        for event in &parsed.events {
            if event.raw.event_type != "tool.execution_complete" {
                continue;
            }
            let Some(native) = &event.raw.native else {
                continue;
            };
            let result = &native.data["toolUseResult"];
            let name = event.raw.data["toolCallId"]
                .as_str()
                .and_then(|id| native_names.get(id))
                .map_or("", String::as_str);
            let content = event.raw.data["result"]["content"].as_str().unwrap_or("");
            let mut bump = |key: &'static str| *self.tools.entry(key).or_default() += 1;
            match name {
                "Read" if result["type"] == "text" => {
                    bump("Read text results");
                    if result["file"]["content"].is_string() && result["file"]["startLine"].is_u64()
                    {
                        bump("Read results with file.content + startLine");
                    }
                    if !all_lines_numbered(content) {
                        bump("Read results with unnumbered (appended) lines");
                    }
                }
                "Read" if result["type"] == "image" => bump("Read image results"),
                "Edit" => {
                    bump("Edit results");
                    if result["structuredPatch"]
                        .as_array()
                        .is_some_and(|p| !p.is_empty())
                    {
                        bump("Edit results with structuredPatch");
                    }
                    if result["userModified"] == Value::Bool(true) {
                        bump("Edit results userModified");
                    }
                    if result.is_string() {
                        bump("Edit error results (string)");
                    }
                }
                "Write" => match result["type"].as_str() {
                    Some("create") => bump("Write create"),
                    Some("update") => bump("Write update"),
                    _ => bump("Write other/error"),
                },
                _ => {}
            }
        }
    }

    fn print(&self) {
        println!("\n## Claude Code probe (aggregates only)\n");
        println!(
            "- Sessions: {} ({} parse errors)",
            self.sessions, self.parse_errors
        );
        println!(
            "- Parse + reconstruct time: total {:.2?}, slowest session {:.2?}",
            self.parse_time, self.slowest
        );
        println!(
            "- Round-trip turn mismatches: {}",
            self.round_trip_mismatches
        );
        println!(
            "- Events: {} ({} native-only)",
            self.events, self.unknown_events
        );
        println!("\n### Diagnostics\n");
        for (key, n) in &self.counters {
            println!("- {key}: {n}");
        }
        println!("- Unknown record types: {:?}", self.unknown_record_types);
        println!(
            "- Unlisted attachment types: {:?}",
            self.unknown_attachment_types
        );
        println!("\n### Canonical events\n");
        for (kind, n) in &self.canonical_events {
            println!("- {kind}: {n}");
        }
        println!("\n### Turns\n");
        println!(
            "- Turns {}; human prompts {}; system-initiated {}",
            self.turns, self.prompts, self.system_turns
        );
        println!(
            "- Incomplete turns other than a session's last: {} {:?}",
            self.incomplete_not_last, self.incomplete_causes
        );
        println!("- Interrupt shapes: {:?}", self.interrupts);
        println!(
            "- Turns per interaction: {}",
            distribution(&self.turns_per_prompt)
        );
        println!(
            "- Tool-only turns (no main-agent text): {}",
            self.tool_only_turns
        );
        println!(
            "- Subagent tool calls {} ({} complete); messages attributed to subagents {}",
            self.subagent_calls, self.subagent_calls_complete, self.agent_messages_attached
        );
        println!("\n### Usage reconciliation\n");
        println!(
            "- Calls {} ({} on abandoned branches); by model {:?}",
            self.calls, self.abandoned_calls, self.calls_by_model
        );
        println!(
            "- Sessions with a snapshot {}, without {}; resumed (>1 distinct snapshot) {}; \
             with a tail {} ({} tail calls)",
            self.with_snapshot,
            self.without_snapshot,
            self.resumed,
            self.with_tail,
            self.tail_calls
        );
        println!("\nCoverage = transcript calls before the last snapshot ÷ snapshot:\n");
        println!("| Model | {} |", CATEGORIES.join(" | "));
        println!("| --- |{}", " ---: |".repeat(CATEGORIES.len()));
        for (model, cats) in &self.coverage {
            let cells: Vec<String> = cats
                .iter()
                .map(|(t, s)| {
                    if *s == 0 {
                        format!("{t} / 0")
                    } else {
                        format!("{:.1}%", *t as f64 * 100.0 / *s as f64)
                    }
                })
                .collect();
            println!("| {model} | {} |", cells.join(" | "));
        }
        println!(
            "\nResidual classes (per session × model): {:?}",
            self.residuals
        );
        println!(
            "Per class (rows, rows with an away summary, distinct titles): {:?}",
            self.class_correlates
        );
        for line in &self.unexplained {
            println!("- {line}");
        }
        println!("\n### Tool results (rendering inputs)\n");
        for (key, n) in &self.tools {
            println!("- {key}: {n}");
        }
    }
}

/// Possible unpersisted side calls on the session model: away summaries
/// (`system:away_summary`) and title changes (distinct `ai-title` values).
/// Titles are compared in memory and only counted.
fn side_call_correlates(parsed: &ClaudeParse) -> (usize, usize) {
    let away = parsed
        .events
        .iter()
        .filter(|e| e.raw.data["infoType"] == "away_summary")
        .count();
    let titles: std::collections::HashSet<&str> = parsed
        .events
        .iter()
        .filter_map(|e| e.raw.native.as_ref())
        .filter(|n| n.record_type == "ai-title")
        .filter_map(|n| n.data["aiTitle"].as_str())
        .collect();
    (away, titles.len())
}

fn category_pairs(tr: &TokenTotals, snap: &CostModelUsage) -> [(u64, u64); 4] {
    [
        (tr.input_tokens, snap.input_tokens),
        (tr.cache_read_tokens, snap.cache_read_input_tokens),
        (tr.cache_write_tokens, snap.cache_creation_input_tokens),
        (tr.output_tokens, snap.output_tokens),
    ]
}

fn round_trip_matches(parsed: &ClaudeParse, turns: &[ConversationTurn]) -> bool {
    let raws: Vec<&RawEvent> = parsed.events.iter().map(|e| &e.raw).collect();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    std::fs::write(&path, events_to_jsonl(&raws)).unwrap();
    let Ok(reparsed) = parse_typed_events(&path) else {
        return false;
    };
    serde_json::to_value(turns).unwrap()
        == serde_json::to_value(reconstruct_turns(&reparsed.events)).unwrap()
}

fn all_lines_numbered(content: &str) -> bool {
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .all(|line| {
            let digits = line
                .trim_start()
                .chars()
                .take_while(char::is_ascii_digit)
                .count();
            digits > 0 && line.trim_start()[digits..].starts_with(['\t', '.', ':'])
        })
}

fn distribution(values: &[usize]) -> String {
    if values.is_empty() {
        return "none".into();
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let at = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
    let ones = sorted.iter().filter(|v| **v == 1).count();
    format!(
        "n {}, median {}, p90 {}, max {}, single-turn {}",
        sorted.len(),
        at(0.5),
        at(0.9),
        sorted[sorted.len() - 1],
        ones
    )
}
