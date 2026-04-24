//! Runtime preference-guard tests (ADR-0007). Split out of `tests.rs` to
//! stay under the 500-LOC per-file cap enforced by
//! `scripts/check-file-sizes.mjs`.

use super::*;
use crate::bridge::{
    BridgeConnectConfig, BridgeError, BridgeSessionConfig, CopilotSdkEnabledReader,
};

/// Minimal tracked session used by the cached-resume test. Kept local to
/// this module so the file stands alone (see the sibling `tests.rs` for
/// the richer stub helpers used by lifecycle tests).
fn stub_tracked_session(id: &str) -> std::sync::Arc<copilot_sdk::Session> {
    std::sync::Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        |_method, _params| Box::pin(async { Ok(serde_json::Value::Null) }),
    ))
}

#[tokio::test]
async fn connect_disabled_by_preference_returns_error() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let reader: CopilotSdkEnabledReader = std::sync::Arc::new(|| false);
    mgr.set_preference_reader(reader);

    let result = mgr
        .connect(BridgeConnectConfig {
            cli_url: None,
            cwd: None,
            log_level: None,
            github_token: None,
        })
        .await;
    assert!(
        matches!(result, Err(BridgeError::DisabledByPreference)),
        "expected DisabledByPreference, got {result:?}"
    );

    // Status must reflect the preference state.
    let status = mgr.status();
    assert!(!status.enabled_by_preference);
    assert!(status.sdk_available);
}

#[tokio::test]
async fn create_session_disabled_by_preference_has_no_side_effects() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let reader: CopilotSdkEnabledReader = std::sync::Arc::new(|| false);
    mgr.set_preference_reader(reader);

    let before = mgr.sessions.len();
    let result = mgr
        .create_session(BridgeSessionConfig {
            model: None,
            working_directory: None,
            system_message: None,
            reasoning_effort: None,
            agent: None,
        })
        .await;
    assert!(
        matches!(result, Err(BridgeError::DisabledByPreference)),
        "expected DisabledByPreference, got {result:?}"
    );
    assert_eq!(
        mgr.sessions.len(),
        before,
        "pref-gated create_session must not mutate session map"
    );
}

#[tokio::test]
async fn create_session_enabled_by_preference_proceeds_to_require_client() {
    // With reader=true and no client connected, the guard must *not* fire —
    // we should hit `require_client` and surface NotConnected instead.
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let reader: CopilotSdkEnabledReader = std::sync::Arc::new(|| true);
    mgr.set_preference_reader(reader);

    let result = mgr
        .create_session(BridgeSessionConfig {
            model: None,
            working_directory: None,
            system_message: None,
            reasoning_effort: None,
            agent: None,
        })
        .await;
    assert!(
        matches!(result, Err(BridgeError::NotConnected)),
        "expected NotConnected (proving guard did NOT short-circuit), got {result:?}"
    );
}

#[tokio::test]
async fn resume_session_cached_bypasses_preference_guard() {
    // A session already tracked before the user toggled the pref off must
    // remain resolvable by `resume_session` — the cached-return branch runs
    // before the preference check.
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let reader: CopilotSdkEnabledReader = std::sync::Arc::new(|| false);
    mgr.set_preference_reader(reader);

    let sid = "sess-prior".to_string();
    mgr.sessions.insert(sid.clone(), stub_tracked_session(&sid));

    let info = mgr
        .resume_session(&sid, Some("/work"), Some("gpt-5"))
        .await
        .expect("cached resume must succeed even when pref is off");
    assert_eq!(info.session_id, sid);
    assert!(info.is_active);
}

#[tokio::test]
async fn resume_session_fresh_disabled_by_preference_returns_error() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let reader: CopilotSdkEnabledReader = std::sync::Arc::new(|| false);
    mgr.set_preference_reader(reader);

    let result = mgr
        .resume_session("sess-new", Some("/work"), Some("gpt-5"))
        .await;
    assert!(
        matches!(result, Err(BridgeError::DisabledByPreference)),
        "expected DisabledByPreference for fresh resume, got {result:?}"
    );
}
