use super::*;
use std::collections::HashSet;

fn tracked_record(session_id: &str, origin: SessionOrigin) -> RegistryUpsert {
    RegistryUpsert {
        session_id: session_id.to_string(),
        origin,
        connection_mode: Some("stdio".to_string()),
        cli_url: None,
        working_directory: Some("C:\\work".to_string()),
        model: Some("gpt-5.5".to_string()),
        reasoning_effort: Some("medium".to_string()),
        agent: Some("copilot".to_string()),
        desired_state: DesiredSessionState::Tracked,
        runtime_state: RuntimeSessionState::Running,
        last_error: None,
    }
}

#[test]
fn upsert_persists_required_registry_fields_without_secrets() {
    let registry = SessionRegistry::in_memory().unwrap();

    registry
        .upsert(tracked_record("sess-1", SessionOrigin::ManualLink))
        .unwrap();

    let records = registry.list().unwrap();
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(record.session_id, "sess-1");
    assert_eq!(record.origin, SessionOrigin::ManualLink);
    assert_eq!(record.connection_mode.as_deref(), Some("stdio"));
    assert_eq!(record.working_directory.as_deref(), Some("C:\\work"));
    assert_eq!(record.model.as_deref(), Some("gpt-5.5"));
    assert_eq!(record.reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(record.agent.as_deref(), Some("copilot"));
    assert_eq!(record.desired_state, DesiredSessionState::Tracked);
    assert_eq!(record.runtime_state, RuntimeSessionState::Running);
    assert!(record.last_error.is_none());
}

#[test]
fn manual_linked_sessions_are_not_auto_resumed_after_restart() {
    let registry = SessionRegistry::in_memory().unwrap();
    registry
        .upsert(tracked_record("manual", SessionOrigin::ManualLink))
        .unwrap();
    registry.mark_unknown_except(&HashSet::new()).unwrap();

    let decisions = registry.recovery_decisions().unwrap();
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].session_id, "manual");
    assert!(!decisions[0].should_auto_resume);
    assert_eq!(decisions[0].reason, "origin requires explicit user action");
    assert_eq!(
        decisions[0].record.runtime_state,
        RuntimeSessionState::Unknown
    );
}

#[test]
fn launcher_origin_tracked_sessions_are_recoverable_when_stale() {
    let registry = SessionRegistry::in_memory().unwrap();
    registry
        .upsert(tracked_record("launcher", SessionOrigin::LauncherSdk))
        .unwrap();
    registry.mark_unknown_except(&HashSet::new()).unwrap();

    let decisions = registry.recovery_decisions().unwrap();
    assert_eq!(decisions.len(), 1);
    assert!(decisions[0].should_auto_resume);
    assert_eq!(
        decisions[0].reason,
        "safe origin is eligible for auto-resume"
    );
}

#[test]
fn unlink_destroy_forget_and_prune_update_registry() {
    let registry = SessionRegistry::in_memory().unwrap();
    registry
        .upsert(tracked_record("old", SessionOrigin::ManualLink))
        .unwrap();
    registry
        .mark_desired(
            "old",
            DesiredSessionState::Destroyed,
            RuntimeSessionState::Shutdown,
        )
        .unwrap();

    assert_eq!(registry.prune_terminal_older_than_days(-1).unwrap(), 1);
    assert!(registry.list().unwrap().is_empty());

    registry
        .upsert(tracked_record("forget-me", SessionOrigin::ManualLink))
        .unwrap();
    assert!(registry.forget("forget-me").unwrap());
    assert!(!registry.forget("forget-me").unwrap());
}
