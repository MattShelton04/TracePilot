//! Claude Code 2.1.301+ request records (`api-request*`): they make no event
//! and change nothing else a session shows.

use serde_json::{Value, json};
use tracepilot_test_support::claude::{OPUS, SESSION_ID, Transcript, Usage, text, write_session};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::{all_fixtures, parse};
use crate::SessionId;
use crate::provider::claude_code::{
    ClaudeCodeProvider, MAX_RECORDED_CALLS, RecordedCount, read_request_log,
};
use crate::provider::{ProviderSnapshot, SessionProvider};

fn snapshot(files: &tracepilot_test_support::claude::SessionFiles) -> ProviderSnapshot {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .unwrap();
    provider.load_snapshot(&locator, false, &|| false).unwrap()
}

/// A record without a uuid is named by its line (`line-12:eof_turn_end`),
/// and the request records' lines move the later lines of the file.
fn without_line_number(id: &str) -> String {
    match id.split_once("line-") {
        Some((head, rest)) => {
            let tail = rest.trim_start_matches(|c: char| c.is_ascii_digit());
            format!("{head}line-N{tail}")
        }
        None => id.to_string(),
    }
}

/// Event indices shift when events are left out; everything else must not.
fn without_event_indices(mut value: Value) -> Value {
    fn strip(value: &mut Value) {
        match value {
            Value::Object(map) => {
                map.remove("eventIndex");
                map.values_mut().for_each(strip);
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            _ => {}
        }
    }
    strip(&mut value);
    value
}

#[test]
fn request_records_parse_to_the_same_session_as_without_them() {
    let with = fixtures::request_records(true);
    let without = fixtures::request_records(false);
    let (a, b) = (parse(&with), parse(&without));

    let events = |p: &super::ClaudeParse| -> Vec<Value> {
        p.events
            .iter()
            .map(|e| {
                let id = e.raw.id.as_deref().map(without_line_number);
                let parent = e.raw.parent_id.as_deref().map(without_line_number);
                json!([
                    e.raw.event_type,
                    id,
                    e.raw.timestamp,
                    e.raw.agent_id,
                    parent,
                    e.raw.data,
                    e.raw.native.as_ref().map(|n| &n.data)
                ])
            })
            .collect()
    };
    let (ea, eb) = (events(&a), events(&b));
    for (x, y) in ea.iter().zip(&eb) {
        assert_eq!(x, y, "canonical event");
    }
    assert_eq!(ea.len(), eb.len(), "canonical events");
    // Lines move; usage and request times do not.
    let calls = |p: &super::ClaudeParse| {
        let mut calls = p.calls.clone();
        for call in &mut calls {
            (call.line, call.snapshot_anchor) = (0, None);
        }
        calls
    };
    assert_eq!(
        calls(&a),
        calls(&b),
        "per-call usage, request times included"
    );
    assert_eq!(a.cost_snapshots.len(), b.cost_snapshots.len());

    let (sa, sb) = (snapshot(&with), snapshot(&without));
    let summary = |s: &ProviderSnapshot| {
        let mut value = serde_json::to_value(&s.summary).unwrap();
        value.as_object_mut().unwrap().remove("eventCount");
        value["shutdownMetrics"]["coverage"]["snapshotLine"] = Value::Null;
        value
    };
    assert_eq!(summary(&sa), summary(&sb), "summary");
    assert_eq!(
        sa.summary.event_count, sb.summary.event_count,
        "event count"
    );
    let turns =
        |s: &ProviderSnapshot| without_event_indices(serde_json::to_value(&s.turns).unwrap());
    assert_eq!(turns(&sa), turns(&sb), "turns");
    let metrics = |s: &ProviderSnapshot| {
        let m = s.metrics.as_ref().unwrap();
        let mut coverage = m.coverage.clone();
        if let Some(coverage) = &mut coverage {
            coverage.snapshot_line = None;
        }
        let mut models: Vec<_> = m
            .model_metrics
            .iter()
            .map(|(k, v)| format!("{k}{v:?}"))
            .collect();
        models.sort();
        let segments: Vec<_> = m
            .segments
            .iter()
            .map(|s| {
                (
                    s.start,
                    s.end,
                    s.requests,
                    s.api_duration_ms,
                    s.cost,
                    s.partial,
                )
            })
            .collect();
        format!(
            "{:?} {:?} {:?} {:?} {:?} {:?} {models:?} {segments:?}",
            m.total_api_duration_ms,
            m.total_tool_duration_ms,
            m.total_duration_ms,
            m.cost,
            coverage,
            m.current_model
        )
    };
    assert_eq!(metrics(&sa), metrics(&sb), "metrics");

    // Counted, known, and never listed as format drift.
    assert_eq!(a.diagnostics.request_records, 9);
    assert_eq!(b.diagnostics.request_records, 0);
    assert_eq!(
        a.diagnostics.unknown_record_types,
        b.diagnostics.unknown_record_types
    );
    assert!(
        sa.format
            .unwrap()
            .unmapped_record_types
            .keys()
            .all(|k| !k.starts_with("api-request")),
        "request records are not format drift"
    );
}

#[test]
fn a_request_record_still_marks_when_the_call_was_sent() {
    let mut t = Transcript::main();
    t.prompt("Hi.");
    t.idle(10);
    t.api_request("req-1", None, "shape-1", OPUS, &[]);
    t.call(
        "msg_1",
        OPUS,
        vec![text("Hello.")],
        Usage::new(1, 1, 0, 1),
        "end_turn",
    );
    // A request whose response never arrived, the latest record.
    t.at(100)
        .api_request("req-2", Some("req-1"), "shape-1", OPUS, &[]);
    let files = write_session(&t, &[]);

    let parsed = parse(&files);
    assert_eq!(
        parsed.calls[0].requested_at.unwrap().to_rfc3339(),
        "2026-09-20T10:00:11+00:00",
        "the request record's time, not the prompt's"
    );
    let summary = snapshot(&files).summary;
    assert_eq!(
        summary.updated_at.unwrap().to_rfc3339(),
        "2026-09-20T10:01:40+00:00"
    );
    assert!(
        parsed
            .events
            .iter()
            .all(|e| !e.raw.event_type.starts_with("api-request")),
        "no event for a request record"
    );
}

#[test]
fn sessions_from_before_request_records_are_parsed_as_before() {
    for (name, files) in all_fixtures() {
        let parsed = parse(&files);
        assert_eq!(parsed.diagnostics.request_records, 0, "{name}");
        assert!(parsed.request_times.is_empty(), "{name}");
    }
    // A prompt quoting a request record is still an ordinary prompt.
    let mut t = Transcript::main();
    let quoted = r#"Why does {"type":"api-request"} appear in my transcript?"#;
    t.prompt(quoted);
    t.call(
        "msg_1",
        OPUS,
        vec![text("It logs requests.")],
        Usage::new(1, 1, 0, 1),
        "end_turn",
    );
    let parsed = parse(&write_session(&t, &[]));
    let prompt = parsed
        .events
        .iter()
        .find(|e| e.raw.event_type == "user.message")
        .unwrap();
    assert_eq!(prompt.raw.data["content"], quoted);
    assert_eq!(parsed.diagnostics.request_records, 0);
}

#[test]
fn the_request_log_lists_each_shape_once_with_its_calls() {
    let files = fixtures::request_records(true);
    let log = read_request_log(&files.main, &|| false).unwrap();
    assert_eq!((log.records, log.files, log.unreadable_records), (9, 2, 0));
    assert_eq!(log.total_calls, 4);
    assert_eq!(log.calls_without_shape, 0);
    assert_eq!(
        log.models,
        [RecordedCount {
            name: OPUS.into(),
            calls: 4
        }]
    );
    let agents: Vec<_> = log
        .agents
        .iter()
        .map(|a| (a.agent_id.as_deref(), a.agent_type.as_deref(), a.calls))
        .collect();
    assert_eq!(
        agents,
        [(None, None, 3), (Some("agentQ"), Some("Explore"), 1)]
    );

    let hashes: Vec<_> = log.shapes.iter().map(|s| s.hash.as_str()).collect();
    assert_eq!(hashes, [fixtures::MAIN_SHAPE, fixtures::AGENT_SHAPE]);
    let main = &log.shapes[0];
    assert_eq!(main.calls, 3);
    assert_eq!(main.system[0].content, "You are a synthetic coding agent.");
    assert_eq!(main.system.len(), 2);
    let tools: Vec<_> = main.tools.iter().map(|t| t.name.as_deref()).collect();
    assert_eq!(tools, [Some("Agent"), Some("Read")]);
    assert!(main.tools[0].schema.is_some());
    assert_eq!(
        main.system_bytes,
        main.system.iter().map(|b| b.bytes).sum::<u64>()
    );
    assert!(main.tool_bytes > 0);
    assert_eq!(
        log.shapes[1].agents[0].agent_type.as_deref(),
        Some("Explore")
    );

    // Calls in time order, with their settings and nothing of the safeguards.
    let first = &log.calls[0];
    assert_eq!(first.query_source.as_deref(), Some("repl_main_thread"));
    assert_eq!(first.max_tokens, Some(64000));
    assert_eq!(first.effort.as_deref(), Some("high"));
    assert_eq!(first.thinking.as_deref(), Some("adaptive"));
    assert_eq!(first.context_edits, ["clear_thinking"]);
    assert_eq!(first.cache_breakpoints, 2);
    assert!(!first.extends_previous);
    assert_eq!(log.calls[1].agent_id.as_deref(), Some("agentQ"));
    assert!(log.calls[2].extends_previous);
    let wire = serde_json::to_string(&log).unwrap();
    assert!(
        !wire.contains("dev@example.com"),
        "classifier context left out"
    );
    assert!(
        !wire.contains("Synthetic CLAUDE.md"),
        "request messages left out"
    );
}

#[test]
fn a_session_from_before_request_records_has_an_empty_log() {
    let files = fixtures::request_records(false);
    let log = read_request_log(&files.main, &|| false).unwrap();
    assert_eq!((log.records, log.total_calls, log.files), (0, 0, 2));
    assert!(log.shapes.is_empty() && log.calls.is_empty());
}

#[test]
fn the_request_log_keeps_the_latest_calls_and_counts_cut_records() {
    let mut t = Transcript::main();
    t.prompt("Hi.");
    let total = MAX_RECORDED_CALLS + 5;
    for n in 0..total {
        t.at(10 + n as u64)
            .api_request(&format!("req-{n}"), None, "shape-missing", OPUS, &[]);
    }
    let quoted = r#"Why does {"type":"api-request"} appear?"#;
    t.prompt(quoted);
    t.raw_line(r#"{"type":"api-request","timestamp":"2026-09-20T"#);
    let log = read_request_log(&write_session(&t, &[]).main, &|| false).unwrap();
    assert_eq!(log.total_calls, total);
    assert_eq!(log.calls.len(), MAX_RECORDED_CALLS);
    let last = log.calls.last().unwrap().timestamp.unwrap();
    assert_eq!(last.to_rfc3339(), "2026-09-20T10:33:34+00:00");
    assert_eq!(log.calls_without_shape, total, "no shape record for them");
    assert_eq!(
        log.unreadable_records, 1,
        "the cut-off line, not the prompt"
    );
}
