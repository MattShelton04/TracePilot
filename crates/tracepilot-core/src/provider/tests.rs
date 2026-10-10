use std::collections::HashMap;
use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::ids::SessionId;
use crate::models::event_types::ToolExecStartData;
use crate::models::session_summary::ShutdownMetrics;
use crate::parsing::events::RawEvent;

#[test]
fn session_source_wire_names() {
    assert_eq!(json!(SessionSource::Copilot), json!("copilot"));
    assert_eq!(json!(SessionSource::ClaudeCode), json!("claudeCode"));
}

#[test]
fn stored_names_match_wire_names() {
    for source in SessionSource::ALL {
        assert_eq!(json!(source), json!(source.as_str()));
        assert_eq!(SessionSource::from_stored(source.as_str()), Some(source));
    }
    assert_eq!(SessionSource::from_stored("codex"), None);
    for role in [
        SessionRole::Primary,
        SessionRole::Subagent,
        SessionRole::Guardian,
    ] {
        assert_eq!(json!(role), json!(role.as_str()));
        assert_eq!(role.hidden_by_default(), role == SessionRole::Guardian);
    }
}

#[test]
fn each_source_reports_its_providers_capabilities() {
    let copilot = CopilotProvider::new("unused");
    let claude = claude_code::ClaudeCodeProvider::new("unused");
    assert_eq!(
        copilot.capabilities(),
        SessionSource::Copilot.capabilities()
    );
    assert_eq!(
        claude.capabilities(),
        SessionSource::ClaudeCode.capabilities()
    );
    // Billing: Copilot alone has premium requests and final exit totals.
    let (copilot, claude) = (copilot.capabilities(), claude.capabilities());
    assert!(copilot.has_premium_requests && copilot.has_exit_metrics);
    assert!(!claude.has_premium_requests && !claude.has_exit_metrics);
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

// ── Registry smoke test with a test-only second source ─────────────

pub(super) const FIXTURE_ID: &str = "11111111-2222-4333-8444-555555555555";

/// A stand-in for a non-Copilot source that emits a hand-written event
/// stream from memory.
pub(super) struct FixtureProvider;

impl FixtureProvider {
    pub(super) fn locator() -> SessionLocator {
        SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(FIXTURE_ID),
            primary_path: "fixture/session.jsonl".into(),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        }
    }
}

pub(super) fn fixture_events() -> Vec<crate::parsing::events::TypedEvent> {
    use crate::models::event_types::SessionEventType;
    use crate::parsing::events::{TypedEvent, typed_data_from_raw};
    [
        json!({"type": "user.message", "data": {"content": "hi", "interactionId": "i1"}, "id": "e1"}),
        json!({"type": "assistant.turn_start", "data": {"turnId": "t1", "interactionId": "i1"}, "id": "e2"}),
        json!({"type": "assistant.message", "data": {"messageId": "m1", "content": "hello", "interactionId": "i1"}, "id": "e3"}),
        json!({"type": "assistant.turn_end", "data": {"turnId": "t1"}, "id": "e4"}),
    ]
    .into_iter()
    .map(|value| {
        let raw: RawEvent = serde_json::from_value(value).unwrap();
        let event_type = SessionEventType::parse_wire(&raw.event_type);
        let (typed_data, _) = typed_data_from_raw(&event_type, &raw.data);
        TypedEvent {
            raw,
            event_type,
            typed_data,
        }
    })
    .collect()
}

impl SessionProvider for FixtureProvider {
    fn source(&self) -> SessionSource {
        SessionSource::ClaudeCode
    }

    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities::default()
    }

    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> crate::Result<Vec<SessionLocator>> {
        crate::parsing::snapshot::check_cancelled(&is_cancelled)?;
        Ok(vec![Self::locator()])
    }

    fn fingerprint(&self, _session: &SessionLocator) -> crate::Result<SourceFingerprint> {
        Ok(SourceFingerprint::new(Vec::new(), Some("v1".into())))
    }

    fn load_snapshot(
        &self,
        session: &SessionLocator,
        _strict: bool,
        _is_cancelled: &dyn Fn() -> bool,
    ) -> crate::Result<ProviderSnapshot> {
        let events = fixture_events();
        let turns = crate::turns::reconstruct_turns(&events);
        let summary = crate::models::session_summary::SessionSummary {
            id: session.id.to_string(),
            summary: Some("Fixture".into()),
            repository: None,
            branch: None,
            cwd: None,
            host_type: None,
            created_at: None,
            updated_at: None,
            event_count: Some(events.len()),
            has_events: true,
            has_session_db: false,
            has_plan: false,
            has_checkpoints: false,
            checkpoint_count: None,
            turn_count: Some(turns.len()),
            current_model: None,
            current_reasoning_effort: None,
            shutdown_metrics: None,
        };
        Ok(ProviderSnapshot {
            summary,
            events: Some(events),
            turns: Some(turns),
            metrics: None,
            diagnostics: None,
            format: None,
            fingerprint: self.fingerprint(session)?,
        })
    }

    fn liveness(&self, _session: &SessionLocator) -> Liveness {
        Liveness::Unknown
    }

    fn resolve(&self, id: &SessionId) -> crate::Result<Option<SessionLocator>> {
        Ok((id.as_str() == FIXTURE_ID).then(Self::locator))
    }
}

#[test]
fn registry_discovers_resolves_and_loads_each_source() {
    let temp = tempfile::tempdir().unwrap();
    let corpus = tracepilot_test_support::copilot_corpus::write_copilot_corpus(temp.path());
    let mut registry = ProviderRegistry::new();
    assert!(
        registry
            .register(Arc::new(CopilotProvider::new(temp.path())))
            .is_none()
    );
    assert!(registry.register(Arc::new(FixtureProvider)).is_none());
    assert!(registry.register(Arc::new(FixtureProvider)).is_some());
    assert_eq!(registry.providers().len(), 2);

    let inventories = registry.discover_each(&|| false);
    let counts: Vec<_> = inventories
        .iter()
        .map(|inv| (inv.source, inv.sessions.as_ref().unwrap().len()))
        .collect();
    assert_eq!(
        counts,
        vec![
            (SessionSource::Copilot, corpus.len()),
            (SessionSource::ClaudeCode, 1)
        ]
    );
    assert!(
        registry
            .discover_each(&|| true)
            .iter()
            .all(|inv| inv.sessions.is_err())
    );

    let fixture_id = SessionId::from_validated(FIXTURE_ID);
    let locator = registry.resolve(&fixture_id).unwrap().unwrap();
    assert_eq!(locator, FixtureProvider::locator());
    let provider = registry.get(locator.source).unwrap();
    assert_eq!(provider.liveness(&locator), Liveness::Unknown);
    let snapshot = provider.load_snapshot(&locator, true, &|| false).unwrap();
    let turns = snapshot.turns.unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].user_message.as_deref(), Some("hi"));
    assert_eq!(turns[0].assistant_messages[0].content, "hello");
    assert_eq!(snapshot.fingerprint.version_token.as_deref(), Some("v1"));

    let copilot_id = SessionId::from_validated(corpus[0].0.id);
    let copilot = registry.resolve(&copilot_id).unwrap().unwrap();
    assert_eq!(copilot.source, SessionSource::Copilot);
    let snapshot = registry
        .get(copilot.source)
        .unwrap()
        .load_snapshot(&copilot, true, &|| false)
        .unwrap();
    assert_eq!(snapshot.summary.id, copilot_id.as_str());

    let missing = SessionId::from_validated("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(registry.resolve(&missing).unwrap(), None);
}
