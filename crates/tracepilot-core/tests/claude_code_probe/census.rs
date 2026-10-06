//! Census of human prompts that get no model call before the next prompt
//! (implementation-plan.md C3). Prints shapes only: record types, key names,
//! length buckets and in-memory text comparisons, never text or ids.

use std::collections::BTreeMap;

use serde_json::Value;
use tracepilot_core::provider::claude_code::ClaudeParse;

/// Key names every enveloped record carries; left out of the key shape.
const ENVELOPE: &[&str] = &[
    "type",
    "uuid",
    "parentUuid",
    "isSidechain",
    "timestamp",
    "sessionId",
    "cwd",
    "gitBranch",
    "version",
    "entrypoint",
    "userType",
    "message",
    "slug",
];

/// `<tag>` prefixes Claude Code writes itself; any other tag prints as `<other>`.
const KNOWN_TAGS: &[&str] = &[
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-stderr",
    "local-command-caveat",
    "bash-input",
    "bash-stdout",
    "bash-stderr",
    "system-reminder",
    "task-notification",
    "user-prompt-submit-hook",
];

#[derive(Default)]
pub struct Census {
    /// What follows a no-call prompt → count.
    pub followed_by: BTreeMap<&'static str, usize>,
    /// Shape signature of each "then compaction" prompt → count.
    pub shapes: BTreeMap<String, usize>,
    /// Main-file `user` records by the first event they emit.
    pub user_records: BTreeMap<String, usize>,
}

impl Census {
    pub fn add(&mut self, parsed: &ClaudeParse) {
        for (event, position) in parsed.events.iter().zip(&parsed.positions) {
            let (Some(native), Some(position)) = (&event.raw.native, position) else {
                continue;
            };
            let first = event.raw.id.as_deref().is_some_and(|id| id.ends_with(":0"));
            if native.record_type != "user" || position.file_agent_id.is_some() || !first {
                continue;
            }
            let kind = &event.raw.event_type;
            let label = match event.raw.data["source"].as_str() {
                Some(source) if source.starts_with("command-") => format!("{kind} (command-*)"),
                Some(source) => format!("{kind} ({source})"),
                None if kind == "user" && native.data["isCompactSummary"] == true => {
                    "native only (compact summary)".into()
                }
                None if kind == "user" => {
                    let text = native
                        .data
                        .pointer("/message/content")
                        .map(Value::to_string);
                    if text.is_some_and(|t| t.contains("<task-notification>")) {
                        "native only (repeated notification)".into()
                    } else {
                        "native only (other)".into()
                    }
                }
                None => kind.clone(),
            };
            *self.user_records.entry(label).or_default() += 1;
        }
        let main: Vec<usize> = (0..parsed.events.len())
            .filter(|&i| {
                parsed.positions[i]
                    .as_ref()
                    .is_none_or(|p| p.file_agent_id.is_none())
            })
            .filter(|&i| parsed.events[i].raw.agent_id.is_none())
            .collect();
        for (k, &i) in main.iter().enumerate() {
            let event = &parsed.events[i].raw;
            if event.event_type != "user.message" || event.data["source"] != "user" {
                continue;
            }
            let rest = &main[k + 1..];
            let next = rest
                .iter()
                .position(|&j| parsed.events[j].raw.event_type == "user.message");
            let Some(next) = next else { continue };
            let between = &rest[..next];
            let kinds = |kind: &str| {
                between
                    .iter()
                    .any(|&j| parsed.events[j].raw.event_type == kind)
            };
            if kinds("assistant.turn_start") {
                continue;
            }
            let follow = if kinds("session.compaction_complete") {
                "compaction"
            } else if kinds("session.error") {
                "session.error"
            } else if kinds("abort") {
                "abort"
            } else {
                "next prompt directly"
            };
            *self.followed_by.entry(follow).or_default() += 1;
            if follow == "compaction" {
                let shape = shape(parsed, i, between, rest[next]);
                *self.shapes.entry(shape).or_default() += 1;
            }
        }
    }

    pub fn print(&self) {
        println!("\n### Main-file `user` records by first emitted event\n");
        for (label, n) in &self.user_records {
            println!("- {label}: {n}");
        }
        println!("\n### Human prompts with no model call before the next prompt\n");
        println!("- Followed by: {:?}", self.followed_by);
        for (shape, n) in &self.shapes {
            println!("- {n} × {shape}");
        }
    }
}

fn shape(parsed: &ClaudeParse, prompt: usize, between: &[usize], next: usize) -> String {
    let event = |i: usize| &parsed.events[i].raw;
    let text = |i: usize| event(i).data["content"].as_str().unwrap_or("").to_string();
    let native = |i: usize| event(i).native.as_ref().map(|n| &n.data);
    let this = text(prompt);
    let record = native(prompt);
    let content = match record.and_then(|r| r.pointer("/message/content")) {
        Some(Value::String(_)) => "string".to_string(),
        Some(Value::Array(blocks)) => {
            let types: Vec<&str> = blocks
                .iter()
                .map(|b| b["type"].as_str().unwrap_or("?"))
                .collect();
            format!("blocks[{}]", types.join(","))
        }
        _ => "none".to_string(),
    };
    let mut keys: Vec<&str> = record
        .and_then(Value::as_object)
        .map(|m| m.keys().map(String::as_str).collect())
        .unwrap_or_default();
    keys.retain(|k| !ENVELOPE.contains(k));
    keys.sort_unstable();
    let origin = record
        .and_then(|r| r.pointer("/origin/kind"))
        .and_then(Value::as_str)
        .filter(|k| ["human", "peer", "task-notification"].contains(k))
        .unwrap_or("-");
    let prompt_source = record
        .and_then(|r| r["promptSource"].as_str())
        .filter(|s| ["typed", "pasted", "queued"].contains(s))
        .unwrap_or("-");
    let records: Vec<String> = between
        .iter()
        .filter_map(|&j| event(j).native.as_ref())
        .map(|n| match n.data["type"].as_str() {
            Some("user") if n.data["isCompactSummary"] == true => "user:compactSummary".into(),
            Some("user") if n.data["isMeta"] == true => "user:meta".into(),
            _ => n.record_type.clone(),
        })
        .fold(Vec::new(), |mut acc, kind| {
            if acc.last() != Some(&kind) {
                acc.push(kind);
            }
            acc
        });
    let trigger = between
        .iter()
        .map(|&j| event(j))
        .find(|e| e.event_type == "session.compaction_complete")
        .and_then(|e| e.data["trigger"].as_str())
        .unwrap_or("-")
        .to_string();
    let summary_has_prompt = between
        .iter()
        .map(|&j| event(j))
        .filter_map(|e| e.data["summaryContent"].as_str())
        .any(|s| !this.trim().is_empty() && s.contains(this.trim()));
    let next_text = text(next);
    let next_source = event(next).data["source"].as_str().unwrap_or("-");
    let next_source = if next_source.starts_with("command-") {
        "command-*"
    } else {
        next_source
    };
    let same_prompt_id = record.and_then(|r| r["promptId"].as_str()).is_some()
        && record.map(|r| &r["promptId"]) == native(next).map(|r| &r["promptId"]);
    let relation = if next_text == this {
        "equal"
    } else if next_text.contains(this.trim()) {
        "contains"
    } else if this.contains(next_text.trim()) {
        "within"
    } else {
        "different"
    };
    let gap = match (
        event(prompt).timestamp,
        between.iter().find_map(|&j| {
            (event(j).event_type == "session.compaction_start").then_some(event(j).timestamp)?
        }),
    ) {
        (Some(a), Some(b)) => bucket_seconds((b - a).num_seconds()),
        _ => "?",
    };
    format!(
        "prompt {{content {content}, len {}, starts {}, origin {origin}, promptSource {prompt_source}, \
         keys [{}]}} → records [{}] (trigger {trigger}, {gap} after prompt, summary contains prompt: \
         {summary_has_prompt}) → next {{source {next_source}, text {relation}, same promptId {same_prompt_id}}}",
        bucket_len(this.len()),
        leading(&this),
        keys.join(","),
        records.join(" → "),
    )
}

fn bucket_len(n: usize) -> &'static str {
    match n {
        0 => "0",
        1..=20 => "1-20",
        21..=200 => "21-200",
        201..=2000 => "201-2k",
        _ => ">2k",
    }
}

fn bucket_seconds(s: i64) -> &'static str {
    match s {
        i64::MIN..=-1 => "<0s",
        0..=1 => "≤1s",
        2..=60 => "≤1m",
        61..=3600 => "≤1h",
        _ => ">1h",
    }
}

fn leading(text: &str) -> String {
    let text = text.trim_start();
    match text.chars().next() {
        None => "empty".into(),
        Some('<') => {
            let tag: String = text[1..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            if KNOWN_TAGS.contains(&tag.as_str()) {
                format!("<{tag}>")
            } else {
                "<other>".into()
            }
        }
        Some(c @ ('/' | '!' | '#' | '[' | '@')) => format!("'{c}'"),
        Some(c) if c.is_alphabetic() => "letter".into(),
        Some(_) => "other".into(),
    }
}
