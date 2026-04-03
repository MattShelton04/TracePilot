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

pub mod config;
mod commands;
pub mod error;
mod helpers;
pub mod types;
mod validators;

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use types::{SearchSemaphore, SharedOrchestratorState, SharedTaskDb, TurnCache};

/// Build the Tauri plugin that registers all IPC commands.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .setup(|app, _api| {
            app.manage(std::sync::Arc::new(tokio::sync::Semaphore::new(1)));
            app.manage(SearchSemaphore(std::sync::Arc::new(
                tokio::sync::Semaphore::new(1),
            )));
            let turn_cache: TurnCache = Arc::new(Mutex::new(lru::LruCache::new(
                // SAFETY: 10 is non-zero
                NonZeroUsize::new(10).expect("cache capacity is non-zero"),
            )));
            app.manage(turn_cache);

            // Task DB: lazily initialized (None until first use via config path).
            let task_db: SharedTaskDb = Arc::new(Mutex::new(None));
            app.manage(task_db);

            // Orchestrator state: tracks the active orchestrator handle.
            let orch_state: SharedOrchestratorState = Arc::new(Mutex::new(None));
            app.manage(orch_state);

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
            // Export / Import commands (5)
            commands::export_import::export_sessions,
            commands::export_import::preview_export,
            commands::export_import::get_session_sections,
            commands::export_import::preview_import,
            commands::export_import::import_sessions,
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
        ])
        .build()
}