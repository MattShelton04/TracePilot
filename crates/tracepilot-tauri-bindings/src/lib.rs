//! tracepilot-tauri-bindings: Tauri IPC command handlers.
//!
//! Thin async wrappers over tracepilot-core/indexer APIs.

pub mod config;

use config::{SharedConfig, TracePilotConfig};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub event_count: Option<usize>,
    pub turn_count: Option<usize>,
    pub current_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsResponse {
    pub events: Vec<EventItem>,
    pub total_count: usize,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventItem {
    pub event_type: String,
    pub timestamp: Option<String>,
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodosResponse {
    pub todos: Vec<tracepilot_core::parsing::session_db::TodoItem>,
    pub deps: Vec<tracepilot_core::parsing::session_db::TodoDep>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateSessionDirResult {
    pub valid: bool,
    pub session_count: usize,
    pub error: Option<String>,
}

mod commands {
    use super::{
        config, EventItem, EventsResponse, SessionListItem, SharedConfig, TodosResponse,
        TracePilotConfig, ValidateSessionDirResult,
    };
    use std::path::Path;

    const MAX_CHECKPOINT_CONTENT_BYTES: usize = 50 * 1024;

    /// Read config from shared state, falling back to defaults.
    fn read_config(state: &SharedConfig) -> TracePilotConfig {
        let guard = state.read().unwrap();
        guard.clone().unwrap_or_default()
    }

    fn truncate_utf8(s: &mut String, max_bytes: usize) {
        if s.len() <= max_bytes {
            return;
        }

        let truncate_at = s
            .char_indices()
            .map(|(idx, _)| idx)
            .take_while(|idx| *idx <= max_bytes)
            .last()
            .unwrap_or(0);
        s.truncate(truncate_at);
    }

    fn summary_to_list_item(summary: tracepilot_core::SessionSummary) -> SessionListItem {
        SessionListItem {
            id: summary.id,
            summary: summary.summary,
            repository: summary.repository,
            branch: summary.branch,
            host_type: summary.host_type,
            created_at: summary.created_at.map(|d| d.to_rfc3339()),
            updated_at: summary.updated_at.map(|d| d.to_rfc3339()),
            event_count: summary.event_count,
            turn_count: summary.turn_count,
            current_model: summary
                .shutdown_metrics
                .as_ref()
                .and_then(|metrics| metrics.current_model.clone()),
        }
    }

    fn load_summary_list_item(session_path: &Path) -> Result<SessionListItem, String> {
        tracepilot_core::summary::load_session_summary(session_path)
            .map(summary_to_list_item)
            .map_err(|e| e.to_string())
    }

    fn open_index_db(
        index_path: &std::path::Path,
    ) -> Option<tracepilot_indexer::index_db::IndexDb> {
        if !index_path.exists() {
            return None;
        }
        let db = tracepilot_indexer::index_db::IndexDb::open_or_create(index_path).ok()?;
        if db.session_count().unwrap_or(0) == 0 {
            return None;
        }
        Some(db)
    }

    // ── Existing Commands (updated for config) ───────────────────────

    #[tauri::command]
    pub async fn list_sessions(
        state: tauri::State<'_, SharedConfig>,
        limit: Option<u32>,
        repo: Option<String>,
        branch: Option<String>,
    ) -> Result<Vec<SessionListItem>, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let session_state_dir = cfg.session_state_dir();

        tokio::task::spawn_blocking(move || {
            // Fast path: query the index DB (single SQLite read, no per-session I/O)
            if index_path.exists() {
                let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                    .map_err(|e| e.to_string())?;

                // Check if index has any sessions; if empty, fall through to disk scan
                let count = db.session_count().unwrap_or(0);
                if count > 0 {
                    let indexed = db
                        .list_sessions(
                            limit.map(|l| l as usize),
                            repo.as_deref(),
                            branch.as_deref(),
                        )
                        .map_err(|e| e.to_string())?;

                    return Ok(indexed
                        .into_iter()
                        .map(|s| SessionListItem {
                            id: s.id,
                            summary: s.summary,
                            repository: s.repository,
                            branch: s.branch,
                            host_type: s.host_type,
                            created_at: s.created_at,
                            updated_at: s.updated_at,
                            event_count: s.event_count.map(|v| v as usize),
                            turn_count: s.turn_count.map(|v| v as usize),
                            current_model: s.current_model,
                        })
                        .collect());
                }
            }

            // Fallback: full disk scan (used when index is empty or missing)
            let sessions =
                tracepilot_core::session::discovery::discover_sessions(&session_state_dir)
                    .map_err(|e| e.to_string())?;

            let mut items = Vec::new();
            for session in sessions {
                let item = match load_summary_list_item(&session.path) {
                    Ok(item) => item,
                    Err(_) => continue,
                };

                if repo
                    .as_ref()
                    .is_some_and(|value| item.repository.as_deref() != Some(value.as_str()))
                {
                    continue;
                }
                if branch
                    .as_ref()
                    .is_some_and(|value| item.branch.as_deref() != Some(value.as_str()))
                {
                    continue;
                }

                items.push(item);
            }

            items.sort_by(|a, b| {
                b.updated_at
                    .cmp(&a.updated_at)
                    .then_with(|| a.id.cmp(&b.id))
            });

            if let Some(limit) = limit {
                items.truncate(limit as usize);
            }

            Ok(items)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_detail(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<tracepilot_core::SessionSummary, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            tracepilot_core::summary::load_session_summary(&path).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_turns(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<Vec<tracepilot_core::ConversationTurn>, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let events_path = path.join("events.jsonl");
            let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)
                .map_err(|e| e.to_string())?;
            Ok(tracepilot_core::turns::reconstruct_turns(&events))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_events(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Result<EventsResponse, String> {
        // NOTE: Currently parses the entire events.jsonl on every page request.
        // For Phase 3, consider caching parsed events in Tauri managed state
        // or implementing streaming/seek-based pagination.
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let events_path = path.join("events.jsonl");
            let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)
                .map_err(|e| e.to_string())?;

            let total_count = events.len();
            let offset = offset.unwrap_or(0) as usize;
            let limit = limit.unwrap_or(total_count as u32) as usize;
            let start = offset.min(total_count);
            let end = start.saturating_add(limit).min(total_count);

            let event_items = events[start..end]
                .iter()
                .map(|event| EventItem {
                    event_type: event.event_type.to_string(),
                    timestamp: event.raw.timestamp.as_ref().map(|ts| ts.to_rfc3339()),
                    id: event.raw.id.clone(),
                    parent_id: event.raw.parent_id.clone(),
                    data: event.raw.data.clone(),
                })
                .collect();

            Ok(EventsResponse {
                events: event_items,
                total_count,
                has_more: end < total_count,
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_todos(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<TodosResponse, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let db_path = path.join("session.db");
            let todos = tracepilot_core::parsing::session_db::read_todos(&db_path)
                .map_err(|e| e.to_string())?;
            let deps = tracepilot_core::parsing::session_db::read_todo_deps(&db_path)
                .map_err(|e| e.to_string())?;

            Ok(TodosResponse { todos, deps })
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_checkpoints(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<Vec<tracepilot_core::parsing::checkpoints::CheckpointEntry>, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let mut checkpoints = tracepilot_core::parsing::checkpoints::parse_checkpoints(&path)
                .map_err(|e| e.to_string())?
                .map(|index| index.checkpoints)
                .unwrap_or_default();

            for checkpoint in &mut checkpoints {
                if let Some(content) = checkpoint.content.as_mut() {
                    truncate_utf8(content, MAX_CHECKPOINT_CONTENT_BYTES);
                }
            }

            Ok(checkpoints)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_shutdown_metrics(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<Option<tracepilot_core::models::event_types::ShutdownData>, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let events_path = path.join("events.jsonl");
            let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)
                .map_err(|e| e.to_string())?;
            Ok(tracepilot_core::parsing::events::extract_shutdown_data(
                &events,
            ))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn search_sessions(
        state: tauri::State<'_, SharedConfig>,
        query: String,
    ) -> Result<Vec<SessionListItem>, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let session_state_dir = cfg.session_state_dir();

        tokio::task::spawn_blocking(move || {
            if !index_path.exists() {
                return Ok(Vec::new());
            }

            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;
            let result_ids = db.search(&query).map_err(|e| e.to_string())?;
            let mut sessions = Vec::new();
            for session_id in result_ids {
                // Use index DB path lookup (no disk scan) instead of resolve_session_path
                let path = match db.get_session_path(&session_id) {
                    Ok(Some(p)) => p,
                    _ => match tracepilot_core::session::discovery::resolve_session_path_in(
                        &session_id,
                        &session_state_dir,
                    ) {
                        Ok(path) => path,
                        Err(_) => continue,
                    },
                };
                let item = match load_summary_list_item(&path) {
                    Ok(item) => item,
                    Err(_) => continue,
                };
                sessions.push(item);
            }

            sessions.sort_by(|a, b| {
                b.updated_at
                    .cmp(&a.updated_at)
                    .then_with(|| a.id.cmp(&b.id))
            });

            Ok(sessions)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Returns (updated, total) session counts.
    #[tauri::command]
    pub async fn reindex_sessions(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<(usize, usize), String> {
        let cfg = read_config(&state);
        let session_state_dir = cfg.session_state_dir();
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            match tracepilot_indexer::reindex_incremental(&session_state_dir, &index_path) {
                Ok((indexed, skipped)) => Ok((indexed, indexed + skipped)),
                Err(_) => tracepilot_indexer::reindex_all(&session_state_dir, &index_path)
                    .map(|n| (n, n))
                    .map_err(|e| e.to_string()),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Full reindex: delete the index DB and rebuild from scratch.
    /// Returns (rebuilt, total) session counts.
    #[tauri::command]
    pub async fn reindex_sessions_full(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<(usize, usize), String> {
        let cfg = read_config(&state);
        let session_state_dir = cfg.session_state_dir();
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            // Delete existing DB to force a clean rebuild
            if index_path.exists() {
                let _ = std::fs::remove_file(&index_path);
                // Also remove WAL/SHM files if present
                let wal = index_path.with_extension("db-wal");
                let shm = index_path.with_extension("db-shm");
                let _ = std::fs::remove_file(&wal);
                let _ = std::fs::remove_file(&shm);
            }

            tracepilot_indexer::reindex_all(&session_state_dir, &index_path)
                .map(|n| (n, n))
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // ── Analytics Commands ────────────────────────────────────────────
    //
    // Fast path: query pre-computed analytics from the index DB (SQL aggregation).
    // Fallback: disk-scan + in-memory computation when index is empty/missing.

    #[tauri::command]
    pub async fn get_analytics(
        state: tauri::State<'_, SharedConfig>,
        from_date: Option<String>,
        to_date: Option<String>,
        repo: Option<String>,
    ) -> Result<tracepilot_core::analytics::AnalyticsData, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let session_state_dir = cfg.session_state_dir();

        tokio::task::spawn_blocking(move || {
            // Fast path: SQL aggregation from pre-computed per-session data
            if let Some(db) = open_index_db(&index_path) {
                match db.query_analytics(
                    from_date.as_deref(),
                    to_date.as_deref(),
                    repo.as_deref(),
                ) {
                    Ok(result) => return Ok(result),
                    Err(e) => eprintln!("Analytics SQL fast path failed, falling back to disk scan: {e}"),
                }
            }

            // Fallback: disk scan + in-memory computation (uses full session loading to include turns)
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                &session_state_dir,
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
            )
            .map_err(|e| e.to_string())?;
            Ok(tracepilot_core::analytics::compute_analytics(&inputs))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_tool_analysis(
        state: tauri::State<'_, SharedConfig>,
        from_date: Option<String>,
        to_date: Option<String>,
        repo: Option<String>,
    ) -> Result<tracepilot_core::analytics::ToolAnalysisData, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let session_state_dir = cfg.session_state_dir();

        tokio::task::spawn_blocking(move || {
            // Fast path: SQL aggregation from session_tool_calls + session_activity
            if let Some(db) = open_index_db(&index_path) {
                match db.query_tool_analysis(
                    from_date.as_deref(),
                    to_date.as_deref(),
                    repo.as_deref(),
                ) {
                    Ok(result) => return Ok(result),
                    Err(e) => eprintln!("Tool analysis SQL fast path failed, falling back to disk scan: {e}"),
                }
            }

            // Fallback: disk scan + in-memory computation
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                &session_state_dir,
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
            )
            .map_err(|e| e.to_string())?;
            Ok(tracepilot_core::analytics::compute_tool_analysis(&inputs))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_code_impact(
        state: tauri::State<'_, SharedConfig>,
        from_date: Option<String>,
        to_date: Option<String>,
        repo: Option<String>,
    ) -> Result<tracepilot_core::analytics::CodeImpactData, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let session_state_dir = cfg.session_state_dir();

        tokio::task::spawn_blocking(move || {
            // Fast path: SQL aggregation from session columns + session_modified_files
            if let Some(db) = open_index_db(&index_path) {
                match db.query_code_impact(
                    from_date.as_deref(),
                    to_date.as_deref(),
                    repo.as_deref(),
                ) {
                    Ok(result) => return Ok(result),
                    Err(e) => eprintln!("Code impact SQL fast path failed, falling back to disk scan: {e}"),
                }
            }

            // Fallback: disk scan + in-memory computation
            let inputs = tracepilot_core::analytics::load_session_summaries_filtered(
                &session_state_dir,
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
            )
            .map_err(|e| e.to_string())?;
            Ok(tracepilot_core::analytics::compute_code_impact(&inputs))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // ── Config Commands ──────────────────────────────────────────────

    #[tauri::command]
    pub async fn check_config_exists() -> Result<bool, String> {
        tokio::task::spawn_blocking(|| Ok(config::config_file_path().exists()))
            .await
            .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_config(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<TracePilotConfig, String> {
        Ok(read_config(&state))
    }

    #[tauri::command]
    pub async fn save_config(
        state: tauri::State<'_, SharedConfig>,
        config: TracePilotConfig,
    ) -> Result<(), String> {
        let cfg = config.clone();
        tokio::task::spawn_blocking(move || cfg.save())
            .await
            .map_err(|e| e.to_string())??;

        // Update shared state
        let mut guard = state.write().unwrap();
        *guard = Some(config);
        Ok(())
    }

    #[tauri::command]
    pub async fn validate_session_dir(
        path: String,
    ) -> Result<ValidateSessionDirResult, String> {
        tokio::task::spawn_blocking(move || {
            let dir = std::path::PathBuf::from(&path);
            if !dir.exists() {
                return Ok(ValidateSessionDirResult {
                    valid: false,
                    session_count: 0,
                    error: Some(format!("Directory does not exist: {path}")),
                });
            }
            if !dir.is_dir() {
                return Ok(ValidateSessionDirResult {
                    valid: false,
                    session_count: 0,
                    error: Some(format!("Path is not a directory: {path}")),
                });
            }
            match tracepilot_core::session::discovery::discover_sessions(&dir) {
                Ok(sessions) => Ok(ValidateSessionDirResult {
                    valid: true,
                    session_count: sessions.len(),
                    error: None,
                }),
                Err(e) => Ok(ValidateSessionDirResult {
                    valid: false,
                    session_count: 0,
                    error: Some(e.to_string()),
                }),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_db_size(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<u64, String> {
        let index_path = read_config(&state).index_db_path();

        tokio::task::spawn_blocking(move || {
            Ok(std::fs::metadata(&index_path)
                .map(|m| m.len())
                .unwrap_or(0))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_count(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<usize, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let session_state_dir = cfg.session_state_dir();

        tokio::task::spawn_blocking(move || {
            // Try index DB first
            if let Some(db) = open_index_db(&index_path) {
                if let Ok(count) = db.session_count() {
                    return Ok(count);
                }
            }
            // Fallback to disk scan
            tracepilot_core::session::discovery::discover_sessions(&session_state_dir)
                .map(|s| s.len())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn factory_reset(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<(), String> {
        // Read current config to find real paths before clearing
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let config_path = config::config_file_path();

        tokio::task::spawn_blocking(move || {
            // Delete index DB + WAL/SHM files
            let _ = std::fs::remove_file(&index_path);
            let wal = index_path.with_extension("db-wal");
            let shm = index_path.with_extension("db-shm");
            let _ = std::fs::remove_file(&wal);
            let _ = std::fs::remove_file(&shm);

            // Delete config file
            let _ = std::fs::remove_file(&config_path);
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| e.to_string())??;

        // Clear shared state
        let mut guard = state.write().unwrap();
        *guard = None;
        Ok(())
    }
}

/// Get the plugin to register all commands.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::get_session_detail,
            commands::get_session_turns,
            commands::get_session_events,
            commands::get_session_todos,
            commands::get_session_checkpoints,
            commands::get_shutdown_metrics,
            commands::search_sessions,
            commands::reindex_sessions,
            commands::reindex_sessions_full,
            commands::get_analytics,
            commands::get_tool_analysis,
            commands::get_code_impact,
            commands::check_config_exists,
            commands::get_config,
            commands::save_config,
            commands::validate_session_dir,
            commands::get_db_size,
            commands::get_session_count,
            commands::factory_reset,
        ])
        .build()
}
