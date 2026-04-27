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
pub mod ipc_command_names;
pub mod types;
mod validators;

pub use ipc_command_names::IPC_COMMAND_NAMES;

#[doc(hidden)]
pub mod specta_exports;

use concurrency::IndexingSemaphores;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tracepilot_orchestrator::bridge::CopilotSdkEnabledReader;
use tracepilot_orchestrator::bridge::manager::SharedBridgeManager;
use types::{EventCache, ManifestLock, SharedOrchestratorState, SharedTaskDb, TurnCache};

/// Capacity (in sessions) for the per-process EventCache and TurnCache LRUs.
///
/// Sized to comfortably hold the prefetched window (`PREFETCH_LIMIT` in
/// `SessionListView.vue`) plus a few "currently-open" tabs, so navigating
/// back to the session list never re-parses events for a recently-viewed
/// session — and a webview Ctrl+R refresh stays cheap because the Rust
/// process (and these caches) survives the reload.
const SESSION_CACHE_CAPACITY: usize = 30;

/// Build the Tauri plugin that registers all IPC commands.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .setup(|app, _api| {
            app.manage(Arc::new(IndexingSemaphores::new()));
            let turn_cache: TurnCache =
                Arc::new(Mutex::new(cache::build_session_lru(SESSION_CACHE_CAPACITY)));
            app.manage(turn_cache);

            let event_cache: EventCache =
                Arc::new(Mutex::new(cache::build_session_lru(SESSION_CACHE_CAPACITY)));
            app.manage(event_cache);

            // Task DB: lazily initialized (None until first use via config path).
            let task_db: SharedTaskDb = Arc::new(Mutex::new(None));
            app.manage(task_db);

            // Orchestrator state: tracks the active orchestrator handle.
            let orch_state: SharedOrchestratorState = Arc::new(Mutex::new(None));
            app.manage(orch_state);

            // Manifest lock: serializes concurrent manifest read-modify-write operations.
            let manifest_lock: ManifestLock = Arc::new(Mutex::new(()));
            app.manage(manifest_lock);

            // Copilot SDK bridge manager.
            let (bridge_manager, _bridge_rx, _bridge_status_rx) =
                tracepilot_orchestrator::bridge::BridgeManager::new();
            let shared_bridge: SharedBridgeManager =
                Arc::new(tokio::sync::RwLock::new(bridge_manager));

            // Runtime preference guard (ADR-0007): wire the bridge manager to
            // read the user's `FeaturesConfig.copilot_sdk` toggle so start
            // paths return `DisabledByPreference` when the user opts out.
            // Defaults to `false` (disabled) if the config isn't loaded yet
            // or the RwLock is poisoned — never panics.
            {
                let shared_config = app.state::<crate::config::SharedConfig>().inner().clone();
                let reader: CopilotSdkEnabledReader = Arc::new(move || {
                    shared_config
                        .read()
                        .ok()
                        .and_then(|g| g.as_ref().map(|c| c.features.copilot_sdk))
                        .unwrap_or(false)
                });
                let bridge_for_pref = shared_bridge.clone();
                tauri::async_runtime::block_on(async move {
                    let mut bridge = bridge_for_pref.write().await;
                    bridge.set_preference_reader(reader);
                });
            }

            // Spawn event forwarding task: reads bridge events and emits Tauri IPC events.
            {
                let bridge_for_events = shared_bridge.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(tracing::Instrument::instrument(
                    async move {
                        let rx = bridge_for_events.read().await.subscribe();
                        broadcast::forward_broadcast(rx, app_handle, events::SDK_BRIDGE_EVENT)
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
                        let rx = bridge_for_state.read().await.subscribe_session_state();
                        broadcast::forward_broadcast(
                            rx,
                            app_handle,
                            events::SDK_SESSION_STATE_CHANGED,
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
                        )
                        .await;
                    },
                    tracing::info_span!("bridge_status_forwarder"),
                ));
            }
            app.manage(shared_bridge);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Session commands (12)
            commands::session::list_sessions,
            commands::session::get_session_detail,
            commands::session::get_session_incidents,
            commands::session::get_session_turns,
            commands::session::check_session_freshness,
            commands::session::get_session_events,
            commands::session::get_session_todos,
            commands::session::get_session_checkpoints,
            commands::session::get_session_plan,
            commands::session::get_shutdown_metrics,
            commands::session::get_tool_result,
            commands::session::resume_session_in_terminal,
            // File browser commands (3)
            commands::file_browser::session_list_files,
            commands::file_browser::session_read_file,
            commands::file_browser::session_read_sqlite,
            // Search commands (12)
            commands::search::search_sessions,
            commands::search::search_content,
            commands::search::get_search_facets,
            commands::search::get_search_stats,
            commands::search::get_search_repositories,
            commands::search::get_search_tool_names,
            commands::search::rebuild_search_index,
            commands::search::reindex_sessions,
            commands::search::reindex_sessions_full,
            commands::search::fts_integrity_check,
            commands::search::fts_optimize,
            commands::search::fts_health,
            commands::search::get_result_context,
            // Analytics commands (3)
            commands::analytics::get_analytics,
            commands::analytics::get_tool_analysis,
            commands::analytics::get_code_impact,
            // Config commands (24)
            commands::config_cmds::check_config_exists,
            commands::config_cmds::get_config,
            commands::config_cmds::save_config,
            commands::config_cmds::validate_session_dir,
            commands::config_cmds::factory_reset,
            commands::config_cmds::get_agent_definitions,
            commands::config_cmds::save_agent_definition,
            commands::config_cmds::get_copilot_config,
            commands::config_cmds::save_copilot_config,
            commands::config_cmds::create_config_backup,
            commands::config_cmds::list_config_backups,
            commands::config_cmds::restore_config_backup,
            commands::config_cmds::delete_config_backup,
            commands::config_cmds::preview_backup_restore,
            commands::config_cmds::diff_config_files,
            commands::config_cmds::discover_copilot_versions,
            commands::config_cmds::get_active_copilot_version,
            commands::config_cmds::get_migration_diffs,
            commands::config_cmds::migrate_agent_definition,
            commands::config_cmds::list_session_templates,
            commands::config_cmds::save_session_template,
            commands::config_cmds::delete_session_template,
            commands::config_cmds::restore_default_templates,
            commands::config_cmds::increment_template_usage,
            // State commands (6)
            commands::state::get_db_size,
            commands::state::get_session_count,
            commands::state::is_session_running,
            commands::state::get_install_type,
            commands::state::check_for_updates,
            commands::state::get_git_info,
            // Orchestration commands (22)
            commands::orchestration::check_system_deps,
            commands::orchestration::list_worktrees,
            commands::orchestration::create_worktree,
            commands::orchestration::remove_worktree,
            commands::orchestration::prune_worktrees,
            commands::orchestration::list_branches,
            commands::orchestration::get_worktree_disk_usage,
            commands::orchestration::is_git_repo,
            commands::orchestration::lock_worktree,
            commands::orchestration::unlock_worktree,
            commands::orchestration::get_worktree_details,
            commands::orchestration::get_default_branch,
            commands::orchestration::fetch_remote,
            commands::orchestration::list_registered_repos,
            commands::orchestration::add_registered_repo,
            commands::orchestration::remove_registered_repo,
            commands::orchestration::toggle_repo_favourite,
            commands::orchestration::discover_repos_from_sessions,
            commands::orchestration::launch_session,
            commands::orchestration::get_available_models,
            commands::orchestration::open_in_explorer,
            commands::orchestration::open_in_terminal,
            // Logging commands (2)
            commands::logging::get_log_path,
            commands::logging::export_logs,
            // Export / Import commands (6)
            commands::export_import::export_sessions,
            commands::export_import::preview_export,
            commands::export_import::get_session_sections,
            commands::export_import::preview_import,
            commands::export_import::import_sessions,
            commands::export_import::export_session_folder_zip,
            // MCP commands (11)
            commands::mcp::mcp_list_servers,
            commands::mcp::mcp_get_server,
            commands::mcp::mcp_add_server,
            commands::mcp::mcp_update_server,
            commands::mcp::mcp_remove_server,
            commands::mcp::mcp_toggle_server,
            commands::mcp::mcp_check_health,
            commands::mcp::mcp_check_server_health,
            commands::mcp::mcp_import_from_file,
            commands::mcp::mcp_import_from_github,
            commands::mcp::mcp_compute_diff,
            // Skills commands (19)
            commands::skills::skills_list_all,
            commands::skills::skills_get_skill,
            commands::skills::skills_create,
            commands::skills::skills_update,
            commands::skills::skills_update_raw,
            commands::skills::skills_delete,
            commands::skills::skills_rename,
            commands::skills::skills_duplicate,
            commands::skills::skills_list_assets,
            commands::skills::skills_add_asset,
            commands::skills::skills_copy_asset_from,
            commands::skills::skills_remove_asset,
            commands::skills::skills_read_asset,
            commands::skills::skills_import_local,
            commands::skills::skills_import_file,
            commands::skills::skills_import_github,
            commands::skills::skills_gh_auth_status,
            commands::skills::skills_discover_github,
            commands::skills::skills_import_github_skill,
            commands::skills::skills_discover_local,
            commands::skills::skills_discover_repos,
            // Task system commands (16)
            commands::tasks::task_create,
            commands::tasks::task_create_batch,
            commands::tasks::task_get,
            commands::tasks::task_list,
            commands::tasks::task_cancel,
            commands::tasks::task_retry,
            commands::tasks::task_delete,
            commands::tasks::task_stats,
            commands::tasks::task_list_jobs,
            commands::tasks::task_cancel_job,
            commands::tasks::task_list_presets,
            commands::tasks::task_get_preset,
            commands::tasks::task_save_preset,
            commands::tasks::task_delete_preset,
            commands::tasks::task_orchestrator_health,
            commands::tasks::task_orchestrator_start,
            commands::tasks::task_orchestrator_stop,
            commands::tasks::task_ingest_results,
            commands::tasks::task_attribution,
            // SDK bridge commands
            commands::sdk::sdk_connect,
            commands::sdk::sdk_disconnect,
            commands::sdk::sdk_status,
            commands::sdk::sdk_hydrate,
            commands::sdk::sdk_get_session_state,
            commands::sdk::sdk_list_session_states,
            commands::sdk::sdk_cli_status,
            commands::sdk::sdk_create_session,
            commands::sdk::sdk_resume_session,
            commands::sdk::sdk_send_message,
            commands::sdk::sdk_abort_session,
            commands::sdk::sdk_destroy_session,
            commands::sdk::sdk_unlink_session,
            commands::sdk::sdk_set_session_mode,
            commands::sdk::sdk_set_session_model,
            commands::sdk::sdk_list_sessions,
            commands::sdk::sdk_get_quota,
            commands::sdk::sdk_get_auth_status,
            commands::sdk::sdk_list_models,
            commands::sdk::sdk_get_foreground_session,
            commands::sdk::sdk_set_foreground_session,
            commands::sdk::sdk_detect_ui_server,
            commands::sdk::sdk_launch_ui_server,
            commands::sdk::sdk_stop_ui_server,
            commands::sdk::sdk_bridge_metrics,
            // Window management commands (2)
            commands::window::open_session_window,
            commands::window::close_session_window,
        ])
        .build()
}

#[cfg(test)]
mod ipc_manifest_tests {
    use super::IPC_COMMAND_NAMES;

    /// Extract every `commands::<module>::<name>,` invoked inside this file's
    /// `tauri::generate_handler![]` block and assert the set matches the
    /// single-source-of-truth constant. Any new command registered via
    /// `generate_handler!` without a corresponding entry in
    /// `ipc_command_names.rs` (or vice-versa) fails the build of this crate
    /// loudly, with an actionable mismatch message.
    ///
    /// This is the Rust-side half of the IPC contract; the TS side is
    /// enforced by `packages/client/src/__tests__/commandContract.test.ts`
    /// via the emitted `packages/client/src/generated/ipc-commands.json`
    /// manifest.
    #[test]
    fn generate_handler_matches_manifest() {
        let source = include_str!("lib.rs");

        let start_marker = "tauri::generate_handler![";
        let start = source
            .find(start_marker)
            .expect("could not locate generate_handler! block in lib.rs");
        let after_start = start + start_marker.len();
        let end_offset = source[after_start..]
            .find("])")
            .expect("could not locate end of generate_handler! block");
        let block = &source[after_start..after_start + end_offset];

        let mut registered: Vec<String> = Vec::new();
        for raw_line in block.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with("//") {
                continue;
            }
            let entry = line.trim_end_matches(',').trim();
            if entry.is_empty() {
                continue;
            }
            let name = entry
                .rsplit("::")
                .next()
                .expect("handler entry must contain `::`");
            assert!(
                !name.is_empty(),
                "empty command name parsed from generate_handler entry: {raw_line:?}"
            );
            registered.push(name.to_string());
        }
        registered.sort();
        registered.dedup_by(|a, b| a == b);

        let mut manifest: Vec<String> =
            IPC_COMMAND_NAMES.iter().map(|s| (*s).to_string()).collect();
        manifest.sort();

        if registered != manifest {
            let registered_set: std::collections::BTreeSet<_> = registered.iter().collect();
            let manifest_set: std::collections::BTreeSet<_> = manifest.iter().collect();
            let only_in_handler: Vec<_> = registered_set.difference(&manifest_set).collect();
            let only_in_manifest: Vec<_> = manifest_set.difference(&registered_set).collect();
            panic!(
                "generate_handler![] and IPC_COMMAND_NAMES disagree. \
                 Update `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs` \
                 and/or the `generate_handler!` block in `lib.rs`, then run \
                 `pnpm gen:bindings` to refresh `packages/client/src/generated/ipc-commands.json`.\n\
                 Only in generate_handler!: {only_in_handler:?}\n\
                 Only in IPC_COMMAND_NAMES:  {only_in_manifest:?}"
            );
        }
    }
}
