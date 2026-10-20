// ──────────────────────────────────────────────────────────────────
// Single source of truth for IPC commands (Tauri ↔ Desktop).
//
// `with_ipc_commands!` holds the one list, grouped by module under
// `crate::commands`. From it:
//   • `IPC_COMMAND_NAMES` (below) is built here; `apps/desktop/src-tauri/build.rs`
//     `include!`s this file to feed `tauri_build::InlinedPlugin::commands()`.
//   • `lib.rs` builds `tauri::generate_handler![]`.
//   • `gen-bindings` emits `packages/client/src/generated/ipc-commands.{json,ts}`;
//     the TS file is the client's `IPC_COMMANDS`.
//
// To add a command: add its name to its module's group, then run
// `pnpm gen:bindings`. A command in a new submodule needs a
// `pub use <submod>::*;` in its parent so the group can name it. If the
// command is specta-typed, also add it to `specta_exports.rs`; a unit test in
// `lib.rs` checks that list and the capability files against this one.
// See docs/tauri-command-registration.md.
//
// This file must stay self-contained: build.rs includes it verbatim.
// ──────────────────────────────────────────────────────────────────

/// Invoke `$callback! { module { command, … } … }` with every IPC command.
macro_rules! with_ipc_commands {
    ($callback:ident) => {
        $callback! {
            session {
                list_sessions,
                get_session_detail,
                get_session_incidents,
                get_session_pull_requests,
                refresh_session_pull_requests,
                refresh_list_pull_requests,
                get_session_turns,
                get_session_turn_activity,
                get_session_context_timeline,
                check_session_freshness,
                get_session_events,
                get_session_todos,
                get_session_checkpoints,
                get_session_plan,
                get_session_file_history,
                get_session_file_version,
                get_shutdown_metrics,
                get_session_prompt_cache,
                get_tool_result,
                get_prompt_image,
                get_session_request_log,
                resume_session_in_terminal,
                context_capture_preflight,
                context_capture_start,
                context_capture_cancel,
                context_capture_list,
                context_capture_get,
                context_capture_delete,
                context_capture_delete_all,
                context_capture_storage_stats,
                context_benchmark_preflight,
                context_benchmark_start,
                context_benchmark_list,
                context_benchmark_get,
                context_benchmark_delete,
            }
            file_browser {
                session_list_files,
                session_read_file,
                session_read_image_preview,
                session_read_sqlite,
                session_search_files,
            }
            search {
                search_sessions,
                search_content,
                get_search_facets,
                get_search_stats,
                get_search_repositories,
                get_search_tool_names,
                rebuild_search_index,
                reindex_sessions,
                reindex_sessions_full,
                fts_integrity_check,
                fts_optimize,
                fts_health,
                get_result_context,
            }
            analytics {
                get_analytics,
                get_tool_analysis,
                get_code_impact,
            }
            config_cmds {
                check_config_exists,
                get_config,
                save_config,
                update_config,
                validate_session_dir,
                factory_reset,
                get_agent_definitions,
                save_agent_definition,
                get_copilot_config,
                save_copilot_config,
                create_config_backup,
                list_config_backups,
                restore_config_backup,
                delete_config_backup,
                preview_backup_restore,
                diff_config_files,
                discover_copilot_versions,
                get_active_copilot_version,
                get_migration_diffs,
                migrate_agent_definition,
                list_session_templates,
                save_session_template,
                delete_session_template,
                restore_default_templates,
                increment_template_usage,
            }
            config_sources {
                validate_claude_config_dir,
            }
            claude_settings {
                get_claude_cleanup_period,
                raise_claude_cleanup_period,
            }
            source_diagnostics {
                get_source_format_diagnostics,
            }
            state {
                get_db_size,
                get_session_count,
                get_session_liveness,
                get_install_type,
                check_for_updates,
                get_git_info,
            }
            orchestration {
                check_system_deps,
                list_worktrees,
                create_worktree,
                remove_worktree,
                prune_worktrees,
                list_branches,
                get_worktree_disk_usage,
                is_git_repo,
                lock_worktree,
                unlock_worktree,
                get_worktree_details,
                get_default_branch,
                fetch_remote,
                list_registered_repos,
                add_registered_repo,
                remove_registered_repo,
                toggle_repo_favourite,
                discover_repos_from_sessions,
                launch_session,
                get_available_models,
                open_in_explorer,
                open_in_terminal,
            }
            agents {
                agents_list,
                agents_get,
                agents_preview,
                agents_save,
                agents_save_raw,
                agents_create,
                agents_delete,
                agents_set_override,
                agents_set_disabled,
                agents_usage_summary,
                agents_usage_detail,
            }
            logging {
                get_log_path,
                export_logs,
            }
            export_import {
                export_sessions,
                preview_export,
                get_session_sections,
                preview_import,
                import_sessions,
                export_session_folder_zip,
            }
            mcp {
                mcp_list_servers,
                mcp_get_server,
                mcp_add_server,
                mcp_update_server,
                mcp_remove_server,
                mcp_toggle_server,
                mcp_check_health,
                mcp_check_server_health,
                mcp_import_from_file,
                mcp_import_from_github,
                mcp_compute_diff,
            }
            skills {
                skills_list_all,
                skills_usage_summary,
                skills_usage_detail,
                skills_get_skill,
                skills_set_enabled,
                skills_create,
                skills_update,
                skills_update_raw,
                skills_delete,
                skills_rename,
                skills_duplicate,
                skills_list_assets,
                skills_add_asset,
                skills_copy_asset_from,
                skills_remove_asset,
                skills_read_asset,
                skills_import_local,
                skills_import_file,
                skills_import_github,
                skills_gh_auth_status,
                skills_discover_github,
                skills_import_github_skill,
                skills_discover_local,
                skills_discover_repos,
            }
            sdk {
                sdk_connect,
                sdk_disconnect,
                sdk_status,
                sdk_hydrate,
                sdk_get_session_state,
                sdk_list_session_states,
                sdk_cli_status,
                sdk_create_session,
                sdk_resume_session,
                sdk_send_message,
                sdk_abort_session,
                sdk_destroy_session,
                sdk_unlink_session,
                sdk_set_session_mode,
                sdk_set_session_model,
                sdk_list_sessions,
                sdk_get_quota,
                sdk_get_auth_status,
                sdk_list_models,
                sdk_get_foreground_session,
                sdk_set_foreground_session,
                sdk_detect_ui_server,
                sdk_launch_ui_server,
                sdk_stop_ui_server,
                sdk_bridge_metrics,
                sdk_live_hosts,
                sdk_attach_session,
            }
            window {
                open_session_window,
                close_session_window,
            }
        }
    };
}

macro_rules! ipc_command_names_const {
    ($($module:ident { $($name:ident),* $(,)? })*) => {
        /// Every Tauri IPC command exposed by the TracePilot desktop plugin,
        /// in `with_ipc_commands!` order. Generated manifests sort it.
        pub const IPC_COMMAND_NAMES: &[&str] = &[$($(stringify!($name),)*)*];
    };
}

with_ipc_commands!(ipc_command_names_const);
