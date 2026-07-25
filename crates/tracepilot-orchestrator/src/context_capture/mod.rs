//! Isolated, loopback-only Copilot request capture.

mod capability;
mod listener;
mod persistence;
mod preflight;
mod runner;
mod snapshot;

pub use capability::CliCapabilities;
pub use persistence::{
    delete_all_captures, delete_capture, get_capture, list_captures, storage_stats,
};
pub use preflight::{
    BenchmarkPreflight, CapturePreflight, benchmark_preflight, context_capture_preflight,
};
pub use runner::{
    BenchmarkProfile, CaptureProgress, CaptureStage, ContextCaptureManager,
    StartBenchmarkCaptureRequest, StartCaptureRequest,
};

/// Reserved storage collection for fresh CLI/repository benchmark captures.
pub const BENCHMARK_CAPTURE_COLLECTION_ID: &str = "00000000-0000-4000-8000-000000000001";

pub(crate) const MAX_CAPTURE_BODY_BYTES: usize = 32 * 1024 * 1024;
pub(crate) const MAX_SESSION_COPY_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_PROCESS_STREAM_BYTES: u64 = 1024 * 1024;
pub(crate) const CAPTURE_TIMEOUT_SECS: u64 = 45;
pub(crate) const MAX_CAPTURE_STORAGE_BYTES: u64 = 1024 * 1024 * 1024;
