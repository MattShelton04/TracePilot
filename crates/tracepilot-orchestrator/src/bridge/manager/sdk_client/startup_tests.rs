//! Exercise real startup handshakes rather than injecting connected SDK clients.
use super::super::{BridgeManager, SharedBridgeManager};
use crate::bridge::{BridgeConnectConfig, BridgeConnectionState, BridgeError};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

async fn receive_handshake(listener: &TcpListener) -> (BufReader<TcpStream>, Value) {
    let (stream, _) = timeout(Duration::from_secs(2), listener.accept())
        .await
        .expect("startup connects to peer")
        .expect("peer accepts startup");
    let mut reader = BufReader::new(stream);
    let request = read_request(&mut reader).await;
    assert_eq!(request["method"], "connect");
    (reader, request)
}

async fn read_request(reader: &mut BufReader<TcpStream>) -> Value {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        timeout(Duration::from_secs(2), reader.read_line(&mut line))
            .await
            .expect("startup sends handshake header")
            .expect("peer reads handshake header");
        let line = line.trim();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            content_length = Some(value.trim().parse::<usize>().expect("valid frame length"));
        }
    }
    let mut body = vec![0; content_length.expect("handshake content length")];
    timeout(Duration::from_secs(2), reader.read_exact(&mut body))
        .await
        .expect("startup sends handshake body")
        .expect("peer reads handshake body");
    serde_json::from_slice(&body).expect("valid request JSON")
}

async fn respond(reader: &mut BufReader<TcpStream>, request: &Value, result: Value) {
    let body = serde_json::to_vec(&json!({
        "jsonrpc": "2.0", "id": request["id"], "result": result,
    }))
    .unwrap();
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    reader.get_mut().write_all(header.as_bytes()).await.unwrap();
    reader.get_mut().write_all(&body).await.unwrap();
}

async fn assert_closed(mut reader: BufReader<TcpStream>) {
    let mut byte = [0];
    assert_eq!(
        timeout(Duration::from_secs(2), reader.read(&mut byte))
            .await
            .expect("startup cancellation closes TCP transport")
            .expect("peer observes clean socket close"),
        0,
    );
}

#[tokio::test]
async fn disconnect_closes_external_transport_during_handshake() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let (manager, _, _) = BridgeManager::new();
    let bridge = SharedBridgeManager::new(manager);
    let connecting = bridge.clone();
    let connect = tokio::spawn(async move {
        connecting
            .connect(BridgeConnectConfig {
                cli_url: Some(address),
                cwd: None,
                log_level: None,
                github_token: None,
            })
            .await
    });
    let (reader, _) = receive_handshake(&listener).await;
    timeout(Duration::from_secs(2), bridge.disconnect(false))
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        timeout(Duration::from_secs(2), connect)
            .await
            .unwrap()
            .unwrap(),
        Err(BridgeError::Cancelled)
    ));
    assert_closed(reader).await;
    assert_eq!(
        bridge.read().await.connection_state(),
        BridgeConnectionState::Disconnected
    );
}

#[tokio::test]
async fn attach_startup_deadline_closes_external_transport() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let (manager, _, _) = BridgeManager::new();
    let bridge = SharedBridgeManager::new(manager);
    let attaching = bridge.clone();
    let attach = tokio::spawn(async move { attaching.attach_session("remote", &address).await });
    let (reader, _) = receive_handshake(&listener).await;
    assert!(matches!(
        timeout(Duration::from_secs(7), attach)
            .await
            .unwrap()
            .unwrap(),
        Err(BridgeError::Timeout(_))
    ));
    assert_closed(reader).await;
    let manager = bridge.read().await;
    assert!(!manager.is_tracked("remote"));
    assert!(manager.endpoints.is_empty());
    assert!(manager.session_scopes.is_empty());
}

#[tokio::test]
async fn successful_external_handshake_keeps_transport_usable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let connect = tokio::spawn(async move { super::start_external_client(&address).await });
    let (mut reader, handshake) = receive_handshake(&listener).await;
    respond(&mut reader, &handshake, json!({ "protocolVersion": 3 })).await;
    let client = timeout(Duration::from_secs(2), connect)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let querying = client.clone();
    let query = tokio::spawn(async move { querying.get_status().await });
    let request = read_request(&mut reader).await;
    assert_eq!(request["method"], "status.get");
    respond(
        &mut reader,
        &request,
        json!({ "version": "fake", "protocolVersion": 3 }),
    )
    .await;
    assert_eq!(
        timeout(Duration::from_secs(2), query)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .version,
        "fake"
    );
    client.force_stop();
    assert_closed(reader).await;
}

#[tokio::test]
async fn rejected_external_handshake_closes_transport() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let connect = tokio::spawn(async move { super::start_external_client(&address).await });
    let (mut reader, handshake) = receive_handshake(&listener).await;
    respond(&mut reader, &handshake, json!({ "protocolVersion": 0 })).await;
    assert!(matches!(
        timeout(Duration::from_secs(2), connect)
            .await
            .unwrap()
            .unwrap(),
        Err(BridgeError::ConnectionFailed(_))
    ));
    assert_closed(reader).await;
}
