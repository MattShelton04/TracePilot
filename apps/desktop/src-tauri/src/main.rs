// TracePilot desktop — Tauri entrypoint.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // When built with --features tokio-console, use console-subscriber for
    // async task debugging via `tokio-console`. This REPLACES the normal
    // tauri-plugin-log tracing bridge (Rust logs won't appear in the Tauri
    // log file). Only use for diagnosing async task performance.
    #[cfg(feature = "tokio-console")]
    console_subscriber::init();

    let shared_config = tracepilot_tauri_bindings::config::create_shared_config();

    // Read configured log level, defaulting to Info.
    let log_level = shared_config
        .read()
        .ok()
        .and_then(|guard| guard.as_ref().map(|c| c.logging.level.clone()))
        .map(|s| match s.as_str() {
            "trace" => log::LevelFilter::Trace,
            "debug" => log::LevelFilter::Debug,
            "warn" => log::LevelFilter::Warn,
            "error" => log::LevelFilter::Error,
            _ => log::LevelFilter::Info,
        })
        .unwrap_or(log::LevelFilter::Info);

    tauri::Builder::default()
        .manage(shared_config)
        // Log plugin registered FIRST so all subsequent plugin init is captured.
        // Uses the `log` crate (via fern). Our `tracing::*!` macros are captured
        // because tracing bridges to `log` when no subscriber is set.
        // Do NOT register a tracing-subscriber — it would break this bridge.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("TracePilot".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .max_file_size(10_000_000) // 10MB per file before rotation
                .level(log_level)
                // Suppress noisy third-party crate logs (event-loop / webview internals)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("tracing", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("rustls", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tracepilot_tauri_bindings::init())
        .setup(|_app| {
            log::info!("TracePilot v{} starting", env!("CARGO_PKG_VERSION"));
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Fatal: TracePilot failed to start: {e}");
            std::process::exit(1);
        });
}
