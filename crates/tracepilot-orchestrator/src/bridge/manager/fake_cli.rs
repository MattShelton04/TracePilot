//! Scripted in-memory Copilot CLI peer for bridge unit tests (ADR-0015).
//!
//! Connects a real `github_copilot_sdk::Client` to a tokio duplex pipe via
//! `Client::from_streams`, so tests exercise the official SDK's router,
//! session event loop, and wire encoding without spawning a CLI. The peer
//! speaks Content-Length framed JSON-RPC, records every request, answers
//! each method with a canned result (or an injected error), and can push
//! `session.event` notifications to attached sessions.

use super::sdk_client::SdkSession;
use github_copilot_sdk::{Client, ResumeSessionConfig, SessionId};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

/// Result returned by `session.send`.
pub(super) const FAKE_MESSAGE_ID: &str = "message-1";

#[derive(Default)]
struct Script {
    calls: Vec<(String, Value)>,
    errors: HashMap<String, String>,
    stalled: HashSet<String>,
    /// Errors answered for the next N requests of a method, then cleared.
    transient: HashMap<String, (String, usize)>,
}

/// Handle to the fake peer. Dropping it stops the peer's writer, which the
/// SDK observes as a closed transport.
pub(super) struct FakeCli {
    script: Arc<Mutex<Script>>,
    outbound: mpsc::UnboundedSender<Value>,
}

impl FakeCli {
    /// Start a fake peer and an SDK client connected to it.
    pub(super) fn start() -> (Client, FakeCli) {
        let (client_io, server_io) = tokio::io::duplex(1 << 20);
        let (client_read, client_write) = tokio::io::split(client_io);
        let (server_read, mut server_write) = tokio::io::split(server_io);

        let script = Arc::new(Mutex::new(Script::default()));
        let (outbound, mut outbound_rx) = mpsc::unbounded_channel::<Value>();

        tokio::spawn(async move {
            while let Some(message) = outbound_rx.recv().await {
                let body = serde_json::to_vec(&message).expect("serialize fake frame");
                let header = format!("Content-Length: {}\r\n\r\n", body.len());
                if server_write.write_all(header.as_bytes()).await.is_err()
                    || server_write.write_all(&body).await.is_err()
                {
                    break;
                }
            }
        });

        let reader_script = Arc::clone(&script);
        let responder = outbound.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(server_read);
            while let Some(request) = read_frame(&mut reader).await {
                let (Some(id), Some(method)) = (
                    request.get("id").cloned(),
                    request
                        .get("method")
                        .and_then(Value::as_str)
                        .map(String::from),
                ) else {
                    continue; // Notifications and responses need no reply.
                };
                let params = request.get("params").cloned().unwrap_or(Value::Null);
                let reply = {
                    let mut script = reader_script.lock().unwrap();
                    script.calls.push((method.clone(), params.clone()));
                    if script.stalled.contains(&method) {
                        continue;
                    }
                    let transient =
                        script
                            .transient
                            .get_mut(&method)
                            .and_then(|(message, left)| {
                                (*left > 0).then(|| {
                                    *left -= 1;
                                    message.clone()
                                })
                            });
                    match transient.as_ref().or(script.errors.get(&method)) {
                        Some(message) => json!({
                            "jsonrpc": "2.0", "id": id,
                            "error": { "code": -32000, "message": message },
                        }),
                        None => json!({
                            "jsonrpc": "2.0", "id": id,
                            "result": canned_result(&method, &params),
                        }),
                    }
                };
                if responder.send(reply).is_err() {
                    break;
                }
            }
        });

        let client = Client::from_streams(client_read, client_write, PathBuf::from("."))
            .expect("client from in-memory streams");
        (client, FakeCli { script, outbound })
    }

    /// Every request received so far, as `(method, params)`.
    pub(super) fn calls(&self) -> Vec<(String, Value)> {
        self.script.lock().unwrap().calls.clone()
    }

    /// Method names of every request received so far.
    pub(super) fn methods(&self) -> Vec<String> {
        self.calls().into_iter().map(|(method, _)| method).collect()
    }

    /// Params of the most recent request for `method`.
    pub(super) fn last_params(&self, method: &str) -> Option<Value> {
        self.calls()
            .into_iter()
            .rev()
            .find(|(m, _)| m == method)
            .map(|(_, params)| params)
    }

    /// Forget recorded requests (for example the setup resume).
    pub(super) fn clear_calls(&self) {
        self.script.lock().unwrap().calls.clear();
    }

    /// Answer every future `method` request with a JSON-RPC error.
    pub(super) fn fail(&self, method: &str, message: &str) {
        self.script
            .lock()
            .unwrap()
            .errors
            .insert(method.to_string(), message.to_string());
    }

    /// Answer the next `times` `method` requests with a JSON-RPC error.
    pub(super) fn fail_times(&self, method: &str, message: &str, times: usize) {
        self.script
            .lock()
            .unwrap()
            .transient
            .insert(method.to_string(), (message.to_string(), times));
    }

    /// Never answer future `method` requests, like a peer that died after
    /// the request was written.
    pub(super) fn stall(&self, method: &str) {
        self.script
            .lock()
            .unwrap()
            .stalled
            .insert(method.to_string());
    }

    /// Push a `session.event` notification for `session_id`.
    pub(super) fn push_event(&self, session_id: &str, event_type: &str, data: Value) {
        let event = json!({
            "id": format!("evt-{}", uuid::Uuid::new_v4()),
            "timestamp": "2026-09-26T00:00:00Z",
            "parentId": null,
            "ephemeral": true,
            "type": event_type,
            "data": data,
        });
        self.outbound
            .send(json!({
                "jsonrpc": "2.0",
                "method": "session.event",
                "params": { "sessionId": session_id, "event": event },
            }))
            .expect("fake peer writer alive");
    }
}

/// Resume `id` through a fresh fake peer and return the real SDK session.
/// The setup `session.resume` is cleared from the call log.
pub(super) async fn fake_session(id: &str) -> (Arc<SdkSession>, FakeCli) {
    let (client, fake) = FakeCli::start();
    let session = client
        .resume_session(ResumeSessionConfig::new(SessionId::new(id)))
        .await
        .expect("resume against fake peer");
    fake.clear_calls();
    (Arc::new(session), fake)
}

fn canned_result(method: &str, params: &Value) -> Value {
    match method {
        "session.resume" | "session.create" => json!({
            "sessionId": params.get("sessionId").cloned().unwrap_or(json!("fake-created")),
        }),
        "session.detach" => json!({ "success": true }),
        "session.send" => json!({ "messageId": FAKE_MESSAGE_ID }),
        "session.getForeground" => json!({ "sessionId": null }),
        "session.mode.set" => json!({ "modelChanged": false, "status": "applied" }),
        _ => json!({}),
    }
}

async fn read_frame<R: AsyncBufReadExt + AsyncReadExt + Unpin>(reader: &mut R) -> Option<Value> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.ok()? == 0 {
            return None;
        }
        let line = line.trim();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            content_length = value.trim().parse::<usize>().ok();
        }
    }
    let mut body = vec![0; content_length?];
    reader.read_exact(&mut body).await.ok()?;
    serde_json::from_slice(&body).ok()
}
