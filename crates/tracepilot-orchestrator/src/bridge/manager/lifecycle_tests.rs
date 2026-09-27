use super::fake_cli::fake_session;
use super::*;
use crate::bridge::{BridgeConnectConfig, BridgeConnectionState, BridgeError, ConnectionMode};

#[tokio::test]
async fn connect_is_idempotent_for_same_config_and_preserves_sessions() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    let mgr = super::SharedBridgeManager::new(mgr);
    mgr.write()
        .await
        .set_preference_reader(std::sync::Arc::new(|| false));
    let sid = "sess-connected".to_string();
    mgr.write().await.state = BridgeConnectionState::Connected;
    mgr.write().await.connection_mode = Some(ConnectionMode::Tcp);
    mgr.write().await.cli_url = Some("127.0.0.1:60123".to_string());
    mgr.write().await.connection_cwd = Some("C:\\work".to_string());
    let (session, _fake) = fake_session(&sid).await;
    mgr.write().await.sessions.insert(sid.clone(), session);

    mgr.connect(BridgeConnectConfig {
        cli_url: Some("127.0.0.1:60123".to_string()),
        cwd: Some("C:\\work".to_string()),
        log_level: Some("debug".to_string()),
        github_token: Some("not-stored-or-compared".to_string()),
    })
    .await
    .expect("matching reconnect should be a no-op");

    assert_eq!(mgr.read().await.state, BridgeConnectionState::Connected);
    assert_eq!(mgr.read().await.sessions.len(), 1);
    assert!(mgr.read().await.sessions.contains_key(&sid));
}

#[tokio::test]
async fn connect_rejects_different_config_while_connected() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    let mgr = super::SharedBridgeManager::new(mgr);
    let sid = "sess-connected".to_string();
    mgr.write().await.state = BridgeConnectionState::Connected;
    mgr.write().await.connection_mode = Some(ConnectionMode::Tcp);
    mgr.write().await.cli_url = Some("127.0.0.1:60123".to_string());
    mgr.write().await.connection_cwd = Some("C:\\work".to_string());
    let (session, _fake) = fake_session(&sid).await;
    mgr.write().await.sessions.insert(sid.clone(), session);

    let err = mgr
        .connect(BridgeConnectConfig {
            cli_url: Some("127.0.0.1:60124".to_string()),
            cwd: Some("C:\\work".to_string()),
            log_level: None,
            github_token: None,
        })
        .await
        .expect_err("different connected config must be explicit");

    assert!(matches!(err, BridgeError::AlreadyConnected));
    assert_eq!(mgr.read().await.sessions.len(), 1);
    assert!(mgr.read().await.sessions.contains_key(&sid));
}
