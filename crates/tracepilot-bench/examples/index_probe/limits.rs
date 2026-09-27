//! Resource budgets for the existing per-process indexing probe.

use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

type AnyError = Box<dyn std::error::Error>;

/// Cancel an actual indexing pass from another thread, measuring from the
/// request instant until return (including dropping partial parse buffers).
pub fn cancellation_probe(sessions: &Path, db: &Path) -> Result<serde_json::Value, AnyError> {
    let conn = rusqlite::Connection::open(db)?;
    conn.execute("UPDATE sessions SET search_extractor_version = 0", [])?;
    drop(conn);
    let requested = Arc::new(OnceLock::new());
    let signal = Arc::clone(&requested);
    let worker = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        let _ = signal.set(Instant::now());
    });
    let result = tracepilot_indexer::reindex_search_content(
        sessions,
        db,
        |_| {},
        || requested.get().is_some(),
    )?;
    let returned = Instant::now();
    worker.join().map_err(|panic| {
        std::io::Error::other(format!("cancellation timer panicked: {panic:?}"))
    })?;
    let requested = requested
        .get()
        .ok_or_else(|| std::io::Error::other("missing cancellation timestamp"))?;
    let latency = returned.checked_duration_since(*requested).ok_or_else(|| {
        std::io::Error::other("indexing completed before cancellation; use a larger fixture corpus")
    })?;
    let budget_ms = budget("TRACEPILOT_CANCEL_BUDGET_MS", 250)?;
    if latency.as_millis() > u128::from(budget_ms) {
        return Err(std::io::Error::other(format!(
            "cancellation took {} ms; budget is {budget_ms} ms",
            latency.as_millis()
        ))
        .into());
    }
    Ok(serde_json::json!({
        "indexed": result.0,
        "skipped": result.1,
        "latency_us": latency.as_micros(),
        "budget_ms": budget_ms,
        "request_delay_ms": 50,
    }))
}

pub fn enforce_memory_budget(peak_kib: Option<u64>) -> Result<u64, AnyError> {
    let budget_mib = budget("TRACEPILOT_MEMORY_BUDGET_MIB", 1024)?;
    if let Some(peak) = peak_kib {
        if peak > budget_mib.saturating_mul(1024) {
            return Err(std::io::Error::other(format!(
                "peak memory {peak} KiB exceeds {budget_mib} MiB budget"
            ))
            .into());
        }
    } else {
        return Err(
            std::io::Error::other("peak-memory measurement unavailable on this platform").into(),
        );
    }
    Ok(budget_mib)
}

fn budget(name: &str, default: u64) -> Result<u64, AnyError> {
    let value = match std::env::var(name) {
        Ok(value) => value.parse()?,
        Err(std::env::VarError::NotPresent) => default,
        Err(error) => return Err(error.into()),
    };
    if value == 0 {
        return Err(std::io::Error::other(format!("{name} must be positive")).into());
    }
    Ok(value)
}

/// Kernel process high-water mark. Runs after timing and reads this process,
/// including native SQLite/Rayon allocations, rather than allocator estimates.
pub fn peak_rss_kib() -> Option<u64> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command"])
            .arg(format!(
                "(Get-Process -Id {}).PeakWorkingSet64",
                std::process::id()
            ))
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout)
            .ok()?
            .trim()
            .parse::<u64>()
            .ok()
            .map(|bytes| bytes / 1024)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        status
            .lines()
            .find_map(|line| line.strip_prefix("VmHWM:"))
            .and_then(|value| value.trim().trim_end_matches("kB").trim().parse().ok())
    }
}
