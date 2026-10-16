// Contract fixtures fail fast if setup, parsing, or serialization changes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::fs;

use serde::Deserialize;
use serde_json::Value;
use tracepilot_core::load_session_summary;

#[derive(Debug, Deserialize)]
struct ContractCase {
    name: String,
    events: Vec<Value>,
    wire: AccountingWire,
}

// This is the relevant projection of serialized ShutdownMetrics, shared with
// the frontend test. Ignore unrelated fields so the contract stays focused.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AccountingWire {
    model_metrics: HashMap<String, ModelWire>,
    total_nano_aiu: Option<u64>,
    total_premium_requests: Option<f64>,
    session_segments: Vec<SegmentWire>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ModelWire {
    usage: Option<TokenWire>,
    total_nano_aiu: Option<u64>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct TokenWire {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SegmentWire {
    model_metrics: Option<HashMap<String, ModelWire>>,
    total_nano_aiu: Option<u64>,
    tokens: u64,
    total_requests: u64,
    premium_requests: f64,
}

#[test]
fn raw_shutdown_accounting_matches_the_frontend_wire_contract() {
    let cases: Vec<ContractCase> =
        serde_json::from_str(include_str!("fixtures/contracts/session-accounting.json"))
            .expect("valid shared accounting contract");

    for case in cases {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("workspace.yaml"),
            "id: accounting-contract\n",
        )
        .unwrap();
        let events = case
            .events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(dir.path().join("events.jsonl"), format!("{events}\n")).unwrap();

        // Exercise disk parsing, shutdown aggregation, summary enrichment and
        // camelCase serialization, rather than constructing an idealized DTO.
        let summary = load_session_summary(dir.path()).unwrap();
        assert_eq!(
            summary.event_count,
            Some(case.events.len()),
            "{}",
            case.name
        );
        let serialized = serde_json::to_value(summary).unwrap();
        let wire: AccountingWire =
            serde_json::from_value(serialized["shutdownMetrics"].clone()).unwrap();
        assert_eq!(wire, case.wire, "{}", case.name);
    }
}

/// Copilot CLI writes `session.usage_checkpoint` with cumulative session
/// totals whenever the agent goes idle. A session that is still running, or
/// that ended without a shutdown record, has no shutdown after its latest
/// checkpoint; its observed totals must not be lost.
#[test]
fn a_session_without_a_later_shutdown_takes_its_totals_from_the_latest_usage_checkpoint() {
    use tracepilot_core::parsing::events::{extract_combined_shutdown_data, parse_typed_events};

    let fixture = include_str!("fixtures/versions/v1_0_91_skill_refs.jsonl");
    let lines: Vec<&str> = fixture.lines().filter(|l| !l.trim().is_empty()).collect();
    let shutdowns: Vec<usize> = (0..lines.len())
        .filter(|&i| lines[i].contains(r#""type":"session.shutdown""#))
        .collect();
    assert_eq!(shutdowns.len(), 2);

    // (case, lines kept, session AIC, premium requests, the per-model AIC
    // the shutdowns attribute, shutdowns, metrics timestamp)
    let cases = [
        (
            "first run, never shut down",
            shutdowns[0],
            291_646_800,
            1.0,
            None,
            0,
            "2026-10-04T01:39:48.877Z",
        ),
        (
            "resumed and still running",
            shutdowns[1],
            707_673_600,
            2.0,
            Some(291_646_800),
            1,
            "2026-10-04T01:40:14.141Z",
        ),
        (
            "ended",
            lines.len(),
            707_673_600,
            2.0,
            Some(707_673_600),
            2,
            "2026-10-04T01:40:14.168Z",
        ),
    ];
    for (name, cut, nano, premium, model_nano, count, timestamp) in cases {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("workspace.yaml"),
            "id: checkpoint-contract\n",
        )
        .unwrap();
        let events = dir.path().join("events.jsonl");
        fs::write(&events, lines[..cut].join("\n") + "\n").unwrap();

        // Summary (index, Analytics, session list) and the aggregation the
        // Metrics IPC and export use must report the same observed totals.
        let summary = load_session_summary(dir.path()).unwrap();
        let metrics = summary.shutdown_metrics.expect(name);
        assert_eq!(metrics.total_nano_aiu, Some(nano), "{name}");
        assert_eq!(metrics.total_premium_requests, Some(premium), "{name}");
        assert_eq!(metrics.shutdown_count, Some(count), "{name}");
        // Model rows stay shutdown-only: a checkpoint has no per-model split,
        // so the running run's credits stay unattributed to any model.
        let attributed = metrics
            .model_metrics
            .values()
            .map(|m| m.total_nano_aiu)
            .sum::<Option<u64>>()
            .filter(|_| !metrics.model_metrics.is_empty());
        assert_eq!(attributed, model_nano, "{name}");
        assert!(
            metrics.coverage.is_none(),
            "{name}: Copilot keeps its own accounting"
        );

        let parsed = parse_typed_events(&events).unwrap();
        let (data, shutdown_count) = extract_combined_shutdown_data(&parsed.events).expect(name);
        assert_eq!(data.total_nano_aiu, Some(nano), "{name}");
        assert_eq!(data.total_premium_requests, Some(premium), "{name}");
        assert_eq!(shutdown_count, count, "{name}");
        assert_eq!(
            data.session_segments.map_or(0, |s| s.len()),
            count as usize,
            "{name}: segments are completed runs only"
        );
        assert_eq!(
            data.metrics_timestamp
                .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            Some(timestamp.to_string()),
            "{name}"
        );
    }
}
