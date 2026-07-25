use super::MAX_CAPTURE_BODY_BYTES;
use crate::error::Result;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, mpsc, oneshot};
use tracepilot_core::context_capture::CaptureProtocol;

#[derive(Debug)]
pub struct CapturedRequest {
    pub path: String,
    pub content_type: String,
    pub safe_header_names: Vec<String>,
    pub body: Vec<u8>,
}

#[derive(Clone)]
struct ListenerState {
    request_path: String,
    sender: Arc<Mutex<Option<mpsc::Sender<CapturedRequest>>>>,
    retry_seen: Arc<AtomicBool>,
}

pub struct OneShotListener {
    pub base_url: String,
    pub receiver: mpsc::Receiver<CapturedRequest>,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
    retry_seen: Arc<AtomicBool>,
}

impl OneShotListener {
    pub async fn bind(protocol: CaptureProtocol, nonce: &str) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let suffix = match protocol {
            CaptureProtocol::OpenAiChatCompletions => "/v1/chat/completions",
            CaptureProtocol::OpenAiResponses => "/v1/responses",
            CaptureProtocol::AnthropicMessages => "/v1/messages",
        };
        let request_path = format!("/{nonce}{suffix}");
        let base_suffix = match protocol {
            CaptureProtocol::OpenAiChatCompletions | CaptureProtocol::OpenAiResponses => {
                format!("/{nonce}/v1")
            }
            CaptureProtocol::AnthropicMessages => format!("/{nonce}"),
        };
        let base_url = format!("http://{}{base_suffix}", address);
        let (sender, receiver) = mpsc::channel(1);
        let retry_seen = Arc::new(AtomicBool::new(false));
        let state = ListenerState {
            request_path: request_path.clone(),
            sender: Arc::new(Mutex::new(Some(sender))),
            retry_seen: retry_seen.clone(),
        };
        let app = Router::new()
            .route(&request_path, post(capture_request))
            .with_state(state)
            .layer(DefaultBodyLimit::max(MAX_CAPTURE_BODY_BYTES));
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            let server = axum::serve(listener, app).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            if let Err(error) = server.await {
                tracing::warn!(error = %error, "Context capture listener stopped unexpectedly");
            }
        });
        Ok(Self {
            base_url,
            receiver,
            shutdown: Some(shutdown_tx),
            task,
            retry_seen,
        })
    }

    pub fn retry_seen(&self) -> bool {
        self.retry_seen.load(Ordering::SeqCst)
    }

    pub async fn shutdown(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), &mut self.task).await;
        if !self.task.is_finished() {
            self.task.abort();
        }
    }
}

async fn capture_request(
    State(state): State<ListenerState>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, &'static str) {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !is_json_content_type(&content_type)
        || serde_json::from_slice::<serde_json::Value>(&body).is_err()
    {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "capture requires a JSON request body",
        );
    }
    let safe_allowlist: HashSet<&str> = [
        "accept",
        "content-type",
        "host",
        "user-agent",
        "x-stainless-arch",
        "x-stainless-lang",
        "x-stainless-os",
        "x-stainless-package-version",
        "x-stainless-retry-count",
        "x-stainless-runtime",
        "x-stainless-runtime-version",
    ]
    .into_iter()
    .collect();
    let mut safe_header_names: Vec<String> = headers
        .keys()
        .map(axum::http::HeaderName::as_str)
        .filter(|name| safe_allowlist.contains(*name))
        .map(str::to_string)
        .collect();
    safe_header_names.sort();
    safe_header_names.dedup();

    let sender = state.sender.lock().await.take();
    let Some(sender) = sender else {
        state.retry_seen.store(true, Ordering::SeqCst);
        return (StatusCode::CONFLICT, "capture endpoint already consumed");
    };
    let packet = CapturedRequest {
        path: state.request_path,
        content_type,
        safe_header_names,
        body: body.to_vec(),
    };
    if sender.send(packet).await.is_err() {
        return (StatusCode::GONE, "capture was cancelled");
    }
    (
        StatusCode::BAD_REQUEST,
        "TRACEPILOT_CAPTURE_COMPLETE: request captured; inference intentionally stopped",
    )
}

fn is_json_content_type(value: &str) -> bool {
    value
        .split(';')
        .next()
        .map(str::trim)
        .is_some_and(|value| value == "application/json" || value.ends_with("+json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn captures_one_matching_json_post_and_returns_sentinel() {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let mut listener = OneShotListener::bind(CaptureProtocol::OpenAiResponses, &nonce)
            .await
            .expect("bind");
        let response = reqwest::Client::new()
            .post(format!("{}/responses", listener.base_url))
            .json(&serde_json::json!({"model":"capture"}))
            .send()
            .await
            .expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        let captured = listener.receiver.recv().await.expect("captured request");
        assert_eq!(captured.path, format!("/{nonce}/v1/responses"));
        assert_eq!(captured.body, br#"{"model":"capture"}"#);
        let retry = reqwest::Client::new()
            .post(format!("{}/responses", listener.base_url))
            .json(&serde_json::json!({"model":"capture"}))
            .send()
            .await
            .expect("retry request");
        assert_eq!(retry.status(), reqwest::StatusCode::CONFLICT);
        assert!(listener.retry_seen());
        listener.shutdown().await;
    }

    #[tokio::test]
    async fn rejects_wrong_paths_without_capturing() {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let mut listener = OneShotListener::bind(CaptureProtocol::AnthropicMessages, &nonce)
            .await
            .expect("bind");
        let response = reqwest::Client::new()
            .post(format!("{}/wrong", listener.base_url))
            .json(&serde_json::json!({"model":"capture"}))
            .send()
            .await
            .expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
        assert!(listener.receiver.try_recv().is_err());
        listener.shutdown().await;
    }
}
