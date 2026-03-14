//! tracepilot-tauri-bindings: Tauri IPC command handlers.
//!
//! Thin async wrappers over tracepilot-core/indexer APIs.

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

mod commands {
    use super::{EventItem, EventsResponse, SessionListItem, TodosResponse};
    use std::path::Path;

    const MAX_CHECKPOINT_CONTENT_BYTES: usize = 50 * 1024;

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

    #[tauri::command]
    pub async fn list_sessions(
        limit: Option<u32>,
        repo: Option<String>,
        branch: Option<String>,
    ) -> Result<Vec<SessionListItem>, String> {
        tokio::task::spawn_blocking(move || {
            let base_dir = tracepilot_core::session::discovery::default_session_state_dir();
            let sessions = tracepilot_core::session::discovery::discover_sessions(&base_dir)
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
        session_id: String,
    ) -> Result<tracepilot_core::SessionSummary, String> {
        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path(&session_id)
                .map_err(|e| e.to_string())?;
            tracepilot_core::summary::load_session_summary(&path).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_turns(
        session_id: String,
    ) -> Result<Vec<tracepilot_core::ConversationTurn>, String> {
        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path(&session_id)
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
        session_id: String,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Result<EventsResponse, String> {
        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path(&session_id)
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
    pub async fn get_session_todos(session_id: String) -> Result<TodosResponse, String> {
        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path(&session_id)
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
        session_id: String,
    ) -> Result<Vec<tracepilot_core::parsing::checkpoints::CheckpointEntry>, String> {
        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path(&session_id)
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
        session_id: String,
    ) -> Result<Option<tracepilot_core::models::event_types::ShutdownData>, String> {
        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path(&session_id)
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
    pub async fn search_sessions(query: String) -> Result<Vec<SessionListItem>, String> {
        tokio::task::spawn_blocking(move || {
            let index_path = tracepilot_indexer::default_index_db_path();
            if !index_path.exists() {
                return Ok(Vec::new());
            }

            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;
            let result_ids = db.search(&query).map_err(|e| e.to_string())?;
            let mut sessions = Vec::new();
            for session_id in result_ids {
                let path =
                    match tracepilot_core::session::discovery::resolve_session_path(&session_id) {
                        Ok(path) => path,
                        Err(_) => continue,
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

    #[tauri::command]
    pub async fn reindex_sessions() -> Result<usize, String> {
        tokio::task::spawn_blocking(move || {
            let session_state_dir =
                tracepilot_core::session::discovery::default_session_state_dir();
            let index_path = tracepilot_indexer::default_index_db_path();

            match tracepilot_indexer::reindex_incremental(&session_state_dir, &index_path) {
                Ok((indexed, _skipped)) => Ok(indexed),
                Err(_) => tracepilot_indexer::reindex_all(&session_state_dir, &index_path)
                    .map_err(|e| e.to_string()),
            }
        })
        .await
        .map_err(|e| e.to_string())?
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
        ])
        .build()
}
