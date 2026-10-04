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
