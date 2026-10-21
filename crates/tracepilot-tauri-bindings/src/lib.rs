// Assertions in tests should fail immediately on invalid fixtures.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! tracepilot-tauri-bindings: Tauri IPC command handlers.
//!
//! Thin async wrappers over tracepilot-core/indexer APIs, organised by domain:
//!   - `commands::session`       - session listing, detail, turns, events, todos, checkpoints
//!   - `commands::search`        - FTS search, indexing, facets
//!   - `commands::analytics`     - analytics, tool analysis, code impact
//!   - `commands::config_cmds`   - app config, agent definitions, backups, templates, versions
//!   - `commands::orchestration` - worktrees, repos, launcher, system deps
//!   - `commands::state`         - DB size, session count, updates, git info
//!   - `commands::logging`       - log path, export

pub(crate) mod broadcast;
pub(crate) mod cache;
mod commands;
pub mod concurrency;
pub mod config;
pub mod error;
pub mod events;
mod helpers;
#[macro_use]
pub mod ipc_command_names;
mod providers;
mod services;
pub mod types;
mod validators;

pub use ipc_command_names::IPC_COMMAND_NAMES;

#[doc(hidden)]
pub mod specta_exports;

use concurrency::IndexingSemaphores;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tracepilot_orchestrator::bridge::manager::SharedBridgeManager;
use tracepilot_orchestrator::bridge::{CopilotHomeReader, CopilotSdkEnabledReader};
use types::{EventCache, TurnCache};

/// Expand the `with_ipc_commands!` list into `tauri::generate_handler![]`.
macro_rules! ipc_invoke_handler {
    ($($module:ident { $($name:ident),* $(,)? })*) => {
        tauri::generate_handler![$($(commands::$module::$name,)*)*]
    };
}

/// Build the Tauri plugin that registers all IPC commands.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .setup(|app, _api| {
            app.manage(Arc::new(IndexingSemaphores::new()));
            app.manage(config::ConfigCoordinator::default());
            app.manage(Arc::new(
                services::pull_request_status::PullRequestRefresher::new(Arc::new(
                    tracepilot_orchestrator::github::pull_requests::GhCli,
                )),
            ));
            let session_cache_size = app
                .state::<crate::config::SharedConfig>()
                .read()
                .ok()
                .and_then(|guard| {
                    guard
                        .as_ref()
                        .map(|cfg| cfg.performance.session_cache_size)
                })
                .unwrap_or(crate::config::DEFAULT_SESSION_CACHE_SIZE);
            let turn_cache: TurnCache =
                Arc::new(Mutex::new(cache::build_session_lru(session_cache_size)));
            app.manage(turn_cache);

            let event_cache: EventCache =
                Arc::new(Mutex::new(cache::build_session_lru(session_cache_size)));
            app.manage(event_cache);
            app.manage(tracepilot_orchestrator::context_capture::ContextCaptureManager::default());

            if let Some(cfg) = app
                .state::<crate::config::SharedConfig>()
                .read()
                .ok()
                .and_then(|guard| guard.clone())
                .filter(|cfg| cfg.general.setup_complete)
                && let Err(e) =
                    tracepilot_indexer::index_db::IndexDb::open_or_create(&cfg.index_db_path())
            {
                tracing::warn!(error = %e, "Failed to apply pending index database migrations at startup");
            }

            // Copilot SDK bridge manager.
            let (bridge_manager, _bridge_rx, _bridge_status_rx) =
                tracepilot_orchestrator::bridge::BridgeManager::new();
            let shared_bridge: SharedBridgeManager =
                SharedBridgeManager::new(bridge_manager);

            // Runtime preference guard (ADR-0007): wire the bridge manager to
            // read the user's `FeaturesConfig.copilot_sdk` toggle so start
            // paths return `DisabledByPreference` when the user opts out.
            // Defaults to `false` (disabled) if the config isn't loaded yet
            // or the RwLock is poisoned — never panics.
            {
                let shared_config = app.state::<crate::config::SharedConfig>().inner().clone();
                let home_config = shared_config.clone();
                let reader: CopilotSdkEnabledReader = Arc::new(move || {
                    shared_config
                        .read()
                        .ok()
                        .and_then(|g| g.as_ref().map(|c| c.features.copilot_sdk))
                        .unwrap_or(false)
                });
                // The private CLI must read the sessions TracePilot shows,
                // including from a custom Copilot home.
                let home_reader: CopilotHomeReader = Arc::new(move || {
                    home_config
                        .read()
                        .ok()
                        .and_then(|g| g.as_ref().map(|c| c.copilot_home()))
                        .filter(|home| !home.as_os_str().is_empty())
                });
                let bridge_for_pref = shared_bridge.clone();
                tauri::async_runtime::block_on(async move {
                    let mut bridge = bridge_for_pref.write().await;
                    bridge.set_preference_reader(reader);
                    bridge.set_copilot_home_reader(home_reader);
                });
            }

            // Spawn event forwarding task: reads bridge events and emits Tauri IPC events.
            {
                let bridge_for_events = shared_bridge.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(tracing::Instrument::instrument(
                    async move {
                        let rx = bridge_for_events.read().await.subscribe();
                        broadcast::forward_broadcast(
                            rx,
                            app_handle,
                            events::SDK_BRIDGE_EVENT,
                            // Lag on `event_tx` is already counted at the
                            // SDK→bridge boundary inside the orchestrator's
                            // per-session forwarder (BridgeMetrics::events_*);
                            // the bindings layer just logs here.
                            |_| {},
                        )
                        .await;
                    },
                    tracing::info_span!("bridge_event_forwarder"),
                ));
            }
            // Spawn status change forwarding task.
            {
                let bridge_for_state = shared_bridge.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(tracing::Instrument::instrument(
                    async move {
                        let (rx, metrics) = {
                            let mgr = bridge_for_state.read().await;
                            (mgr.subscribe_session_state(), mgr.metrics())
                        };
                        broadcast::forward_broadcast(
                            rx,
                            app_handle,
                            events::SDK_SESSION_STATE_CHANGED,
                            // w4-8: surface `state_tx` lag in BridgeMetrics so
                            // the diagnostics panel can render it. The
                            // human-readable WARN line is debounced inside
                            // forward_broadcast; counters are not.
                            move |n| {
                                metrics
                                    .state_events_dropped_due_to_lag
                                    .fetch_add(n, std::sync::atomic::Ordering::Relaxed);
                                metrics
                                    .state_lag_occurrences
                                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            },
                        )
                        .await;
                    },
                    tracing::info_span!("bridge_session_state_forwarder"),
                ));
            }
            // Spawn status change forwarding task.
            {
                let bridge_for_status = shared_bridge.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(tracing::Instrument::instrument(
                    async move {
                        let rx = bridge_for_status.read().await.subscribe_status();
                        broadcast::forward_broadcast(
                            rx,
                            app_handle,
                            events::SDK_CONNECTION_CHANGED,
                            |_| {},
                        )
                        .await;
                    },
                    tracing::info_span!("bridge_status_forwarder"),
                ));
            }
            app.manage(shared_bridge);

            Ok(())
        })
        .invoke_handler(with_ipc_commands!(ipc_invoke_handler))
        .build()
}

#[cfg(test)]
mod ipc_manifest_tests {
    use super::IPC_COMMAND_NAMES;
    use std::collections::BTreeSet;

    fn registered() -> BTreeSet<&'static str> {
        IPC_COMMAND_NAMES.iter().copied().collect()
    }

    #[test]
    fn command_names_are_unique() {
        assert_eq!(
            registered().len(),
            IPC_COMMAND_NAMES.len(),
            "with_ipc_commands! lists a command twice"
        );
    }

    /// `specta_exports.rs` types a subset of commands; each must also be
    /// registered, or the typed client would call a command Tauri rejects.
    #[test]
    fn specta_exports_are_registered() {
        let source = include_str!("specta_exports.rs");
        let start_marker = "collect_commands![";
        let start = source
            .find(start_marker)
            .expect("could not locate collect_commands! in specta_exports.rs")
            + start_marker.len();
        let end = start
            + source[start..]
                .find(']')
                .expect("could not locate end of collect_commands!");
        let registered = registered();
        let entries: Vec<&str> = source[start..end]
            .lines()
            .map(|line| line.trim().trim_end_matches(','))
            .filter(|entry| !entry.is_empty() && !entry.starts_with("//"))
            .filter_map(|entry| entry.rsplit("::").next())
            .collect();
        assert!(
            !entries.is_empty(),
            "parsed no commands from collect_commands!"
        );
        let unregistered: Vec<&str> = entries
            .into_iter()
            .filter(|name| !registered.contains(name))
            .collect();
        assert!(
            unregistered.is_empty(),
            "specta_exports.rs exports commands missing from with_ipc_commands! \
             (ipc_command_names.rs): {unregistered:?}"
        );
    }

    /// Every `tracepilot:allow-*` / `deny-*` permission in the desktop
    /// capabilities must name a registered command. Windows may grant a subset.
    #[test]
    fn capabilities_reference_registered_commands() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/capabilities");
        let registered = registered();
        let mut checked = 0;
        let mut unknown = Vec::new();
        for entry in std::fs::read_dir(&dir).expect("read capabilities dir") {
            let path = entry.expect("capabilities entry").path();
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let json: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(&path).expect("read capability file"),
            )
            .expect("parse capability file");
            let permissions = json["permissions"].as_array().expect("permissions array");
            for permission in permissions {
                let id = permission
                    .as_str()
                    .or_else(|| permission["identifier"].as_str())
                    .expect("permission identifier");
                let Some(rest) = id.strip_prefix("tracepilot:") else {
                    continue;
                };
                checked += 1;
                if rest == "default" {
                    continue;
                }
                let command = rest
                    .strip_prefix("allow-")
                    .or_else(|| rest.strip_prefix("deny-"))
                    .map(|kebab| kebab.replace('-', "_"));
                if !command.is_some_and(|c| registered.contains(c.as_str())) {
                    unknown.push(format!("{}: {id}", path.display()));
                }
            }
        }
        assert!(
            checked > 0,
            "no tracepilot permissions found in {}",
            dir.display()
        );
        assert!(
            unknown.is_empty(),
            "capabilities grant commands missing from with_ipc_commands! \
             (ipc_command_names.rs): {unknown:?}"
        );
    }
}
