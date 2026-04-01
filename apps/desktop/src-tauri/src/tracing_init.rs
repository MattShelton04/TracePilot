use std::sync::OnceLock;

use tracing_appender::{non_blocking::WorkerGuard, rolling::RollingFileAppender};
use tracing_subscriber::{filter::LevelFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

static TRACING_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

fn to_tracing_level(level: log::LevelFilter) -> LevelFilter {
    match level {
        log::LevelFilter::Off => LevelFilter::OFF,
        log::LevelFilter::Error => LevelFilter::ERROR,
        log::LevelFilter::Warn => LevelFilter::WARN,
        log::LevelFilter::Info => LevelFilter::INFO,
        log::LevelFilter::Debug => LevelFilter::DEBUG,
        log::LevelFilter::Trace => LevelFilter::TRACE,
    }
}

pub fn init_tracing(app: &tauri::AppHandle, log_level: log::LevelFilter) {
    let log_dir = match app.path().app_log_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("Failed to resolve log directory for tracing: {e}");
            return;
        }
    };

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        log::warn!(
            "Failed to create log directory for tracing at {}: {e}",
            log_dir.display()
        );
        return;
    }

    let file_appender: RollingFileAppender =
        tracing_appender::rolling::daily(&log_dir, "TracePilot-tracing.log");
    let (writer, guard) = tracing_appender::non_blocking(file_appender);
    let _ = TRACING_GUARD.set(guard);

    let level = to_tracing_level(log_level);
    let subscriber = tracing_subscriber::registry().with(
        fmt::layer()
            .with_ansi(false)
            .with_level(true)
            .with_target(false)
            .with_writer(writer)
            .with_filter(level),
    );

    match tracing::subscriber::set_global_default(subscriber) {
        Ok(_) => {
            tracing::info!(
                level = ?log_level,
                log_dir = %log_dir.display(),
                "Tracing subscriber initialized"
            );
        }
        Err(e) => {
            log::warn!("Tracing subscriber already initialized: {e}");
        }
    }
}
