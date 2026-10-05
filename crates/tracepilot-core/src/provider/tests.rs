use std::collections::HashMap;

use serde_json::json;

use super::*;
use crate::models::event_types::ToolExecStartData;
use crate::models::session_summary::ShutdownMetrics;
use crate::parsing::events::RawEvent;

#[test]
fn session_source_wire_names() {
    assert_eq!(json!(SessionSource::Copilot), json!("copilot"));
    assert_eq!(json!(SessionSource::ClaudeCode), json!("claudeCode"));
}

#[test]
fn liveness_is_tagged_by_state() {
    let running = Liveness::Running {
        pid: Some(42),
        status: Some(RunStatus::Busy),
    };
    assert_eq!(
        json!(running),
        json!({ "state": "running", "pid": 42, "status": "busy" })
    );
    assert_eq!(json!(Liveness::Idle), json!({ "state": "idle" }));
}

#[test]
fn source_fingerprint_sorts_files_and_omits_absent_token() {
    let fingerprint = SourceFingerprint::new(
        vec![("b.jsonl".into(), None), ("a.yaml".into(), None)],
        None,
    );
    assert_eq!(
        json!(fingerprint),
        json!({ "files": [["a.yaml", null], ["b.jsonl", null]] })
    );
}

#[test]
fn absent_native_fields_are_not_serialized() {
    let line = r#"{"type":"tool.execution_start","data":{"toolName":"view"},"id":"e1","timestamp":null,"parentId":null,"agentId":null}"#;
    let raw: RawEvent = serde_json::from_str(line).unwrap();
    assert!(raw.native.is_none());
    assert_eq!(serde_json::to_string(&raw).unwrap(), line);

    let start: ToolExecStartData = serde_json::from_value(raw.data).unwrap();
    assert!(start.native_tool_name.is_none());
    assert!(json!(start).get("nativeToolName").is_none());
    assert!(
        json!(ShutdownMetrics::default())
            .get("costAmount")
            .is_none()
    );
}

#[test]
fn native_record_round_trips() {
    let mut raw: RawEvent = serde_json::from_str(r#"{"type":"user.message","data":{}}"#).unwrap();
    raw.native = Some(NativeRecord {
        source: SessionSource::ClaudeCode,
        record_type: "user".into(),
        data: json!({ "uuid": "u1" }),
    });
    let value = json!(raw);
    assert_eq!(
        value["native"],
        json!({ "source": "claudeCode", "recordType": "user", "data": { "uuid": "u1" } })
    );
    let back: RawEvent = serde_json::from_value(value).unwrap();
    assert_eq!(back.native, raw.native);
}

#[test]
fn provider_metrics_never_report_aic_or_premium_requests() {
    let metrics: ShutdownMetrics = SessionMetrics {
        total_api_duration_ms: Some(1200),
        current_model: Some("model-a".into()),
        model_metrics: HashMap::new(),
        cost: Some(CostFigure {
            amount: 0.25,
            unit: CostUnit::Usd,
            basis: CostBasis::ProviderEstimate,
        }),
        ..SessionMetrics::default()
    }
    .into();
    assert_eq!(metrics.total_nano_aiu, None);
    assert_eq!(metrics.total_premium_requests, None);
    assert_eq!(metrics.shutdown_type, None);
    assert_eq!(metrics.total_api_duration_ms, Some(1200));
    let value = json!(metrics);
    assert_eq!(value["costAmount"], json!(0.25));
    assert_eq!(value["costUnit"], json!("usd"));
    assert_eq!(value["costBasis"], json!("providerEstimate"));
}
