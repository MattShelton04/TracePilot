mod benchmark;
mod environment;
mod process;
mod session;

use crate::error::{OrchestratorError, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, Notify};
use tracepilot_core::context_capture::{CaptureProtocol, ContextCaptureSnapshot};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCaptureRequest {
    pub session_id: String,
    pub protocol: CaptureProtocol,
    pub save: bool,
    #[serde(default)]
    pub allow_degraded_fidelity: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BenchmarkProfile {
    IsolatedBaseline,
    CurrentEnvironment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBenchmarkCaptureRequest {
    pub profile: BenchmarkProfile,
    #[serde(default)]
    pub repository_path: Option<String>,
    pub model: String,
    pub protocol: CaptureProtocol,
    pub save: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureStage {
    Preflight,
    CopyingSession,
    PreparingEnvironment,
    StartingListener,
    ResumingClone,
    WaitingForRequest,
    ParsingSnapshot,
    SavingSnapshot,
    CleaningUp,
    Complete,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProgress {
    pub capture_id: String,
    pub session_id: String,
    pub stage: CaptureStage,
    pub message: String,
    pub bytes_copied: Option<u64>,
    pub total_bytes: Option<u64>,
    pub cancellable: bool,
}

#[derive(Default)]
pub struct ContextCaptureManager {
    active: Mutex<Option<ActiveCapture>>,
}

#[derive(Clone)]
pub(super) struct Cancellation {
    cancelled: Arc<AtomicBool>,
    pub(super) notify: Arc<Notify>,
}

impl Cancellation {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

struct ActiveCapture {
    capture_id: String,
    session_id: String,
    cancellation: Cancellation,
}

impl ContextCaptureManager {
    pub async fn start(
        &self,
        request: StartCaptureRequest,
        session_path: PathBuf,
        cli_command: String,
        tracepilot_home: PathBuf,
        progress: Arc<dyn Fn(CaptureProgress) + Send + Sync>,
    ) -> Result<ContextCaptureSnapshot> {
        let capture_id = uuid::Uuid::new_v4().to_string();
        let cancellation = Cancellation::new();
        {
            let mut active = self.active.lock().await;
            if let Some(existing) = active.as_ref() {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Capture {} is already running for session {}.",
                    existing.capture_id, existing.session_id
                )));
            }
            *active = Some(ActiveCapture {
                capture_id: capture_id.clone(),
                session_id: request.session_id.clone(),
                cancellation: cancellation.clone(),
            });
        }

        let result = session::run_capture(
            &capture_id,
            &request,
            &session_path,
            &cli_command,
            &tracepilot_home,
            &cancellation,
            &progress,
        )
        .await;
        self.active.lock().await.take();
        if cancellation.is_cancelled() {
            emit(
                &progress,
                &capture_id,
                &request.session_id,
                CaptureStage::Cancelled,
                "Capture cancelled; isolated temporary state was removed.",
                None,
                None,
                false,
            );
        }
        result
    }

    pub async fn start_benchmark(
        &self,
        request: StartBenchmarkCaptureRequest,
        cli_command: String,
        copilot_home: PathBuf,
        tracepilot_home: PathBuf,
        progress: Arc<dyn Fn(CaptureProgress) + Send + Sync>,
    ) -> Result<ContextCaptureSnapshot> {
        let capture_id = uuid::Uuid::new_v4().to_string();
        let session_id = super::BENCHMARK_CAPTURE_COLLECTION_ID.to_string();
        let cancellation = Cancellation::new();
        {
            let mut active = self.active.lock().await;
            if let Some(existing) = active.as_ref() {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Capture {} is already running.",
                    existing.capture_id
                )));
            }
            *active = Some(ActiveCapture {
                capture_id: capture_id.clone(),
                session_id: session_id.clone(),
                cancellation: cancellation.clone(),
            });
        }
        let result = benchmark::run_benchmark_capture(
            &capture_id,
            &session_id,
            &request,
            &cli_command,
            &copilot_home,
            &tracepilot_home,
            &cancellation,
            &progress,
        )
        .await;
        self.active.lock().await.take();
        if cancellation.is_cancelled() {
            emit(
                &progress,
                &capture_id,
                &session_id,
                CaptureStage::Cancelled,
                "Capture cancelled; temporary state was removed.",
                None,
                None,
                false,
            );
        }
        result
    }

    pub async fn cancel(&self, capture_id: Option<&str>) -> bool {
        let active = self.active.lock().await;
        let Some(active) = active.as_ref() else {
            return false;
        };
        if capture_id.is_some_and(|value| value != active.capture_id) {
            return false;
        }
        active.cancellation.cancel();
        true
    }
}

pub(super) fn check_cancelled(cancellation: &Cancellation) -> Result<()> {
    if cancellation.is_cancelled() {
        Err(OrchestratorError::ContextCapture(
            "Capture cancelled.".into(),
        ))
    } else {
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn emit(
    callback: &Arc<dyn Fn(CaptureProgress) + Send + Sync>,
    capture_id: &str,
    session_id: &str,
    stage: CaptureStage,
    message: &str,
    bytes_copied: Option<u64>,
    total_bytes: Option<u64>,
    cancellable: bool,
) {
    callback(CaptureProgress {
        capture_id: capture_id.to_string(),
        session_id: session_id.to_string(),
        stage,
        message: message.to_string(),
        bytes_copied,
        total_bytes,
        cancellable,
    });
}
