//! Opt-in smoke tests that drive `BridgeManager` against a **real** Copilot
//! CLI (ADR-0015). They are `#[ignore]`d and additionally gated on
//! environment variables, so `cargo test` never spawns a CLI or talks to a
//! model.
//!
//! Stdio (spawns your installed `copilot`; no model calls):
//!
//! ```powershell
//! $env:TRACEPILOT_LIVE_STDIO = "1"
//! cargo test -p tracepilot-orchestrator --test live_copilot_bridge -- --ignored --nocapture
//! ```
//!
//! Attach to a running `copilot --ui-server` (read the port from its log or
//! `Get-NetTCPConnection`). With `TRACEPILOT_LIVE_PROMPT` set, the test sends
//! that prompt into the terminal's foreground session, which spends model
//! quota and appears in the terminal:
//!
//! ```powershell
//! $env:TRACEPILOT_LIVE_CLI_URL = "127.0.0.1:60496"
//! $env:TRACEPILOT_LIVE_PROMPT = "Reply with just the word pong."
//! cargo test -p tracepilot-orchestrator --test live_copilot_bridge -- --ignored --nocapture
//! ```

use std::time::Duration;
use tracepilot_orchestrator::bridge::{
    BridgeConnectConfig, BridgeConnectionState, BridgeManager, BridgeMessagePayload,
};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

#[tokio::test]
#[ignore = "spawns the installed Copilot CLI; set TRACEPILOT_LIVE_STDIO=1"]
async fn stdio_bridge_reports_cli_status_auth_and_models() {
    if env("TRACEPILOT_LIVE_STDIO").is_none() {
        eprintln!("TRACEPILOT_LIVE_STDIO not set; skipping");
        return;
    }
    let (mut mgr, _events, _status) = BridgeManager::new();
    mgr.connect(BridgeConnectConfig {
        cli_url: None,
        cwd: None,
        log_level: None,
        github_token: None,
    })
    .await
    .expect("stdio connect");
    assert_eq!(mgr.connection_state(), BridgeConnectionState::Connected);

    let status = mgr.get_cli_status().await.expect("cli status");
    eprintln!(
        "CLI {:?}, protocol {:?}",
        status.cli_version, status.protocol_version
    );
    assert!(status.cli_version.is_some());
    assert_eq!(
        status.protocol_version,
        Some(github_copilot_sdk::SDK_PROTOCOL_VERSION)
    );

    let auth = mgr.get_auth_status().await.expect("auth status");
    eprintln!(
        "authenticated={} login={:?}",
        auth.is_authenticated, auth.login
    );
    let models = mgr.list_models().await.expect("models");
    eprintln!("{} models", models.len());
    match mgr.get_quota().await {
        Ok(quota) => eprintln!("{} quota snapshots", quota.quotas.len()),
        Err(e) => eprintln!("quota unavailable: {e}"),
    }

    tokio::time::timeout(Duration::from_secs(15), mgr.disconnect())
        .await
        .expect("disconnect within 15s")
        .expect("disconnect ok");
}

#[tokio::test]
#[ignore = "attaches to a running copilot --ui-server; set TRACEPILOT_LIVE_CLI_URL"]
async fn attach_to_ui_server_foreground_session_and_observe() {
    let Some(cli_url) = env("TRACEPILOT_LIVE_CLI_URL") else {
        eprintln!("TRACEPILOT_LIVE_CLI_URL not set; skipping");
        return;
    };
    let (mut mgr, mut events, _status) = BridgeManager::new();
    mgr.connect(BridgeConnectConfig {
        cli_url: Some(cli_url),
        cwd: None,
        log_level: None,
        github_token: None,
    })
    .await
    .expect("attach connect");

    let session_id = mgr
        .get_foreground_session()
        .await
        .expect("foreground query")
        .expect("the ui-server shows a session");
    let info = mgr
        .resume_session(&session_id, None, None)
        .await
        .expect("attach to foreground session");
    assert_eq!(info.session_id, session_id);
    eprintln!("attached to {session_id}");

    let prompt = env("TRACEPILOT_LIVE_PROMPT");
    if let Some(prompt) = &prompt {
        let message_id = mgr
            .send_message(
                &session_id,
                BridgeMessagePayload {
                    prompt: prompt.clone(),
                    mode: None,
                },
            )
            .await
            .expect("send prompt");
        eprintln!("sent message {message_id}");
    }

    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    while let Ok(Ok(event)) = tokio::time::timeout_at(deadline, events.recv()).await {
        eprintln!("{:<40} ephemeral={}", event.event_type, event.ephemeral);
        let idle = event.event_type == "session.idle";
        seen.push(event.event_type);
        if idle && prompt.is_some() {
            break;
        }
    }

    if prompt.is_some() {
        for expected in ["user.message", "assistant.turn_start", "session.idle"] {
            assert!(
                seen.iter().any(|t| t == expected),
                "expected {expected} in {seen:?}"
            );
        }
        let live = mgr.get_session_state(&session_id).expect("live state");
        eprintln!("live status: {:?}", live.status);
    }

    mgr.destroy_session(&session_id)
        .await
        .expect("detach from session");
    mgr.disconnect().await.expect("disconnect");
}
