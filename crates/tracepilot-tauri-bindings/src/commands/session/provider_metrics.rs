//! Metrics IPC uses provider totals when there is no shutdown event.

use tracepilot_core::models::event_types::ShutdownData;
use tracepilot_core::parsing::events::{TypedEvent, extract_combined_shutdown_data};
use tracepilot_core::provider::{ResolvedSession, SessionSource};

pub(super) fn metrics_for_session(
    session: &ResolvedSession,
    events: &[TypedEvent],
) -> tracepilot_core::error::Result<Option<ShutdownData>> {
    if session.locator.source == SessionSource::Copilot {
        // Keep all Copilot aggregation fields and serialization unchanged.
        return Ok(extract_combined_shutdown_data(events).map(|(data, _)| data));
    }
    let summary = session
        .provider
        .summary_from_events(&session.locator, events)?;
    Ok(summary.shutdown_metrics.map(|m| ShutdownData {
        total_api_duration_ms: m.total_api_duration_ms,
        total_api_duration_without_retries_ms: m.total_api_duration_without_retries_ms,
        total_tool_duration_ms: m.total_tool_duration_ms,
        total_duration_ms: m.total_duration_ms,
        session_start_time: m.session_start_time,
        current_model: m.current_model,
        model_metrics: Some(m.model_metrics),
        code_changes: m.code_changes,
        cost_amount: m.cost_amount,
        cost_unit: m.cost_unit,
        cost_basis: m.cost_basis,
        coverage: m.coverage,
        ..ShutdownData::default()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;
    use tracepilot_core::SessionId;
    use tracepilot_core::provider::{
        CopilotProvider, SessionLocator, SessionProvider, SessionRole,
        claude_code::ClaudeCodeProvider,
    };

    #[test]
    fn metrics_ipc_returns_provider_usage_cost_and_coverage_without_a_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("projects").join("demo");
        std::fs::create_dir_all(&project).unwrap();
        let id = "11111111-1111-4111-8111-111111111111";
        let user = json!({"type":"user","uuid":"first","sessionId":id,
            "timestamp":"2026-09-20T10:00:00Z","message":{"role":"user","content":"Hello."}});
        let cost = json!({"type":"cost-state","totalCostUSD":1.25,"totalAPIDuration":123,
            "totalAPIDurationWithoutRetries":120,"totalToolDuration":80,"totalDuration":200,
            "totalLinesAdded":5,"modelUsage":{"claude-opus-5-5":{"inputTokens":1,
                "cacheReadInputTokens":2,"cacheCreationInputTokens":3,"outputTokens":4}}});
        std::fs::write(
            project.join(format!("{id}.jsonl")),
            format!("{user}\n{cost}\n"),
        )
        .unwrap();
        let provider = Arc::new(ClaudeCodeProvider::new(dir.path()));
        let locator = provider.discover(&|| false).unwrap().remove(0);
        let expected = provider
            .load_snapshot(&locator, true, &|| false)
            .unwrap()
            .summary
            .shutdown_metrics
            .unwrap();
        let response = metrics_for_session(&ResolvedSession { provider, locator }, &[])
            .unwrap()
            .unwrap();
        let usage = response.model_metrics.as_ref().unwrap()["claude-opus-5-5"]
            .usage
            .as_ref()
            .unwrap();
        assert_eq!(usage.input_tokens, Some(6));
        assert_eq!(usage.output_tokens, Some(4));
        assert_eq!(response.cost_amount, Some(1.25));
        assert_eq!(
            response.cost_unit,
            Some(tracepilot_core::provider::CostUnit::Usd)
        );
        assert!(response.coverage.as_ref().unwrap().partial);
        assert!(response.total_premium_requests.is_none());
        assert!(response.total_nano_aiu.is_none());
        assert!(response.shutdown_type.is_none());
        let wire = serde_json::to_value(response).unwrap();
        let summary = serde_json::to_value(expected).unwrap();
        for key in [
            "modelMetrics",
            "coverage",
            "costAmount",
            "costUnit",
            "costBasis",
            "totalApiDurationMs",
            "totalApiDurationWithoutRetriesMs",
            "totalToolDurationMs",
            "totalDurationMs",
            "codeChanges",
        ] {
            assert_eq!(wire[key], summary[key], "{key}");
        }
    }

    #[test]
    fn metrics_ipc_keeps_copilot_extraction_and_wire_output_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path,"{\"type\":\"session.shutdown\",\"data\":{\"totalPremiumRequests\":2,\"totalApiDurationMs\":123}}\n").unwrap();
        let events = tracepilot_core::parsing::events::parse_typed_events(&path)
            .unwrap()
            .events;
        let expected = extract_combined_shutdown_data(&events).unwrap().0;
        let session = ResolvedSession {
            provider: Arc::new(CopilotProvider::new(dir.path())),
            locator: SessionLocator {
                source: SessionSource::Copilot,
                id: SessionId::from_validated("synthetic"),
                primary_path: dir.path().into(),
                parent_id: None,
                role: SessionRole::Primary,
                source_bytes_hint: 0,
            },
        };
        let response = metrics_for_session(&session, &events).unwrap().unwrap();
        let wire = serde_json::to_value(response).unwrap();
        assert_eq!(wire, serde_json::to_value(expected).unwrap());
        assert!(wire.get("coverage").is_none());
        assert!(wire.get("costAmount").is_none());
    }

    #[test]
    fn metrics_ipc_modified_files_use_native_editing_provenance() {
        for (tool, rewind) in [("Edit", true), ("ExitPlanMode", false)] {
            let dir = tempfile::tempdir().unwrap();
            let project = dir.path().join("projects").join("demo");
            std::fs::create_dir_all(&project).unwrap();
            let id = "11111111-1111-4111-8111-111111111111";
            let mut records = vec![
                json!({"type":"user","uuid":"first","sessionId":id,
                    "message":{"role":"user","content":"Start."}}),
                json!({"type":"assistant","uuid":"call","parentUuid":"first","sessionId":id,
                    "message":{"id":"call","role":"assistant","model":"claude-opus-5-5",
                        "usage":{"input_tokens":1,"output_tokens":1},"stop_reason":"tool_use",
                        "content":[{"type":"tool_use","id":"tool","name":tool,"input":{}}]}}),
                json!({"type":"user","uuid":"result","parentUuid":"call","sessionId":id,
                    "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool",
                        "is_error":false,"content":"Done."}]},"toolUseResult":{"filePath":"src/file.rs"}}),
            ];
            if rewind {
                records.push(
                    json!({"type":"user","uuid":"replacement","parentUuid":"first","sessionId":id,
                    "message":{"role":"user","content":"Replace the conversation."}}),
                );
            }
            let jsonl = records
                .iter()
                .map(serde_json::Value::to_string)
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write(project.join(format!("{id}.jsonl")), format!("{jsonl}\n")).unwrap();
            let provider = Arc::new(ClaudeCodeProvider::new(dir.path()));
            let locator = provider.discover(&|| false).unwrap().remove(0);
            let response = metrics_for_session(&ResolvedSession { provider, locator }, &[])
                .unwrap()
                .unwrap();
            let files = response.code_changes.and_then(|code| code.files_modified);
            assert_eq!(files, rewind.then(|| vec!["src/file.rs".into()]), "{tool}");
        }
    }
}
