//! tracepilot-tauri-bindings: Tauri IPC command handlers.
//!
//! Thin async wrappers over tracepilot-core/indexer APIs.

pub mod config;

use config::{SharedConfig, TracePilotConfig};
use serde::Serialize;
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use tauri::Manager;

// ── LRU Turn Cache ──────────────────────────────────────────────────

/// Cached turns for a single session, keyed by session ID in the LRU.
struct CachedTurns {
    turns: Vec<tracepilot_core::ConversationTurn>,
    events_file_size: u64,
}

type TurnCache = Arc<Mutex<lru::LruCache<String, CachedTurns>>>;

/// Response wrapper for `get_session_turns` — includes file size for
/// frontend freshness tracking.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnsResponse {
    pub turns: Vec<tracepilot_core::ConversationTurn>,
    pub events_file_size: u64,
}

/// Lightweight freshness probe — just the file size, no parsing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessResponse {
    pub events_file_size: u64,
}

/// A search result item with highlighted snippet and session context.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub id: i64,
    pub session_id: String,
    pub content_type: String,
    pub turn_number: Option<i64>,
    pub event_index: Option<i64>,
    pub timestamp_unix: Option<i64>,
    pub tool_name: Option<String>,
    pub snippet: String,
    pub metadata_json: Option<String>,
    pub session_summary: Option<String>,
    pub session_repository: Option<String>,
    pub session_branch: Option<String>,
    pub session_updated_at: Option<String>,
}

/// Paginated search results wrapper (includes total count for pagination).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultsResponse {
    pub results: Vec<SearchResultItem>,
    pub total_count: i64,
    pub has_more: bool,
    pub query: String,
    pub latency_ms: f64,
}

/// Facet counts response for the filter sidebar.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFacetsResponse {
    pub by_content_type: Vec<(String, i64)>,
    pub by_repository: Vec<(String, i64)>,
    pub by_tool_name: Vec<(String, i64)>,
    pub total_matches: i64,
    pub session_count: i64,
}

/// Search index statistics response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatsResponse {
    pub total_rows: i64,
    pub indexed_sessions: i64,
    pub total_sessions: i64,
    pub content_type_counts: Vec<(String, i64)>,
}

/// Newtype for the search indexing semaphore (separate from main indexing).
pub struct SearchSemaphore(pub Arc<tokio::sync::Semaphore>);

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
    /// Whether this session is currently running (has an `inuse.*.lock` file).
    pub is_running: bool,
    // Incident counts (populated from index DB; None in fallback disk-scan path)
    pub error_count: Option<usize>,
    pub rate_limit_count: Option<usize>,
    pub compaction_count: Option<usize>,
    pub truncation_count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIncidentItem {
    pub event_type: String,
    pub source_event_type: String,
    pub timestamp: Option<String>,
    pub severity: String,
    pub summary: String,
    pub detail_json: Option<serde_json::Value>,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub commit_hash: Option<String>,
    pub branch: Option<String>,
}

/// Enriched indexing progress payload emitted via Tauri events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingProgressPayload {
    pub current: usize,
    pub total: usize,
    /// Per-session info (None if this session was skipped or failed).
    pub session_repo: Option<String>,
    pub session_branch: Option<String>,
    pub session_model: Option<String>,
    pub session_tokens: u64,
    pub session_events: usize,
    pub session_turns: usize,
    /// Running totals across all indexed sessions so far.
    pub total_tokens: u64,
    pub total_events: u64,
    pub total_repos: usize,
}

mod commands {
    use super::{
        config, CachedTurns, EventItem, EventsResponse, FreshnessResponse, GitInfo,
        IndexingProgressPayload, SearchFacetsResponse, SearchResultItem, SearchResultsResponse,
        SearchSemaphore, SearchStatsResponse, SessionIncidentItem, SessionListItem, SharedConfig,
        TodosResponse, TracePilotConfig, TurnCache, TurnsResponse, UpdateCheckResult,
        ValidateSessionDirResult,
    };
    use std::path::Path;
    use std::sync::Arc;
    use tauri::Manager;
    use tauri::Emitter;
    use tokio::sync::Semaphore;

    const MAX_CHECKPOINT_CONTENT_BYTES: usize = 50 * 1024;

    /// Convert an `IndexingProgress` from the indexer into our Tauri event payload and emit it.
    fn emit_indexing_progress(
        app: &tauri::AppHandle,
        progress: &tracepilot_indexer::IndexingProgress,
    ) {
        let payload = IndexingProgressPayload {
            current: progress.current,
            total: progress.total,
            session_repo: progress
                .session_info
                .as_ref()
                .and_then(|s| s.repository.clone()),
            session_branch: progress
                .session_info
                .as_ref()
                .and_then(|s| s.branch.clone()),
            session_model: progress
                .session_info
                .as_ref()
                .and_then(|s| s.current_model.clone()),
            session_tokens: progress
                .session_info
                .as_ref()
                .map_or(0, |s| s.total_tokens),
            session_events: progress
                .session_info
                .as_ref()
                .map_or(0, |s| s.event_count),
            session_turns: progress
                .session_info
                .as_ref()
                .map_or(0, |s| s.turn_count),
            total_tokens: progress.running_tokens,
            total_events: progress.running_events,
            total_repos: progress.running_repos,
        };
        let _ = app.emit("indexing-progress", payload);
    }

    /// Read config from shared state, falling back to defaults.
    fn read_config(state: &SharedConfig) -> TracePilotConfig {
        let guard = state.read().unwrap();
        guard.clone().unwrap_or_default()
    }

    fn truncate_utf8(s: &mut String, max_bytes: usize) {
        let truncated_len = tracepilot_core::utils::truncate_utf8(s.as_str(), max_bytes).len();
        s.truncate(truncated_len);
    }

    fn summary_to_list_item(summary: tracepilot_core::SessionSummary, session_path: &Path) -> SessionListItem {
        let is_running = tracepilot_core::session::discovery::has_lock_file(session_path);
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
            is_running,
            error_count: None,
            rate_limit_count: None,
            compaction_count: None,
            truncation_count: None,
        }
    }

    fn load_summary_list_item(session_path: &Path) -> Result<SessionListItem, String> {
        tracepilot_core::summary::load_session_summary(session_path)
            .map(|s| summary_to_list_item(s, session_path))
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
        hide_empty: Option<bool>,
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
                            hide_empty.unwrap_or(false),
                        )
                        .map_err(|e| e.to_string())?;

                    return Ok(indexed
                        .into_iter()
                        .map(|s| {
                            let is_running = tracepilot_core::session::discovery::has_lock_file(
                                std::path::Path::new(&s.path),
                            );
                            SessionListItem {
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
                                is_running,
                                error_count: s.error_count.map(|v| v as usize),
                                rate_limit_count: s.rate_limit_count.map(|v| v as usize),
                                compaction_count: s.compaction_count.map(|v| v as usize),
                                truncation_count: s.truncation_count.map(|v| v as usize),
                            }
                        })
                        .collect());
                }
            }

            // Fallback: full disk scan (used when index is empty or missing)
            let sessions =
                tracepilot_core::session::discovery::discover_sessions(&session_state_dir)
                    .map_err(|e| e.to_string())?;

            let mut items = Vec::new();
            let should_hide_empty = hide_empty.unwrap_or(false);
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
                if should_hide_empty && item.turn_count.unwrap_or(0) == 0 {
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
    pub async fn get_session_incidents(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<Vec<SessionIncidentItem>, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;
            let incidents = db
                .get_session_incidents(&session_id)
                .map_err(|e| e.to_string())?;
            Ok(incidents
                .into_iter()
                .map(|i| SessionIncidentItem {
                    event_type: i.event_type,
                    source_event_type: i.source_event_type,
                    timestamp: i.timestamp,
                    severity: i.severity,
                    summary: i.summary,
                    detail_json: i
                        .detail_json
                        .and_then(|s| serde_json::from_str(&s).ok()),
                })
                .collect())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_session_turns(
        state: tauri::State<'_, SharedConfig>,
        cache: tauri::State<'_, TurnCache>,
        session_id: String,
    ) -> Result<TurnsResponse, String> {
        let session_state_dir = read_config(&state).session_state_dir();
        let cache = cache.inner().clone();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let events_path = path.join("events.jsonl");

            let file_size = std::fs::metadata(&events_path)
                .map(|m| m.len())
                .unwrap_or(0);

            // Check LRU cache — return if file size unchanged (append-only)
            {
                let mut lru = cache.lock().unwrap();
                if let Some(cached) = lru.get(&session_id) {
                    if cached.events_file_size == file_size {
                        let mut turns = cached.turns.clone();
                        tracepilot_core::turns::prepare_turns_for_ipc(&mut turns);
                        return Ok(TurnsResponse {
                            turns,
                            events_file_size: file_size,
                        });
                    }
                }
            }

            // Cache miss or stale — parse from disk
            let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)
                .map_err(|e| e.to_string())?
                .events;
            let turns = tracepilot_core::turns::reconstruct_turns(&events);

            // Store full (untrimmed) turns in LRU
            {
                let mut lru = cache.lock().unwrap();
                lru.put(
                    session_id,
                    CachedTurns {
                        turns: turns.clone(),
                        events_file_size: file_size,
                    },
                );
            }

            let mut ipc_turns = turns;
            tracepilot_core::turns::prepare_turns_for_ipc(&mut ipc_turns);
            Ok(TurnsResponse {
                turns: ipc_turns,
                events_file_size: file_size,
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Lightweight freshness probe — returns just the events.jsonl file size.
    /// The frontend compares this against the `eventsFileSize` from the last
    /// `get_session_turns` response to decide whether a full re-fetch is needed.
    #[tauri::command]
    pub async fn check_session_freshness(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<FreshnessResponse, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let events_path = path.join("events.jsonl");
            let file_size = std::fs::metadata(&events_path)
                .map(|m| m.len())
                .unwrap_or(0);
            Ok(FreshnessResponse { events_file_size: file_size })
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
                .map_err(|e| e.to_string())?
                .events;

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
    pub async fn get_session_plan(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<Option<serde_json::Value>, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let plan_path = path.join("plan.md");
            if !plan_path.exists() {
                return Ok(None);
            }

            let mut content = std::fs::read_to_string(&plan_path).map_err(|e| e.to_string())?;
            truncate_utf8(&mut content, MAX_CHECKPOINT_CONTENT_BYTES);

            Ok(Some(serde_json::json!({ "content": content })))
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
                .map_err(|e| e.to_string())?
                .events;
            Ok(tracepilot_core::parsing::events::extract_combined_shutdown_data(
                &events,
            )
            .map(|(data, _count)| data))
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
        semaphore: tauri::State<'_, Arc<Semaphore>>,
        search_semaphore: tauri::State<'_, SearchSemaphore>,
        app: tauri::AppHandle,
    ) -> Result<(usize, usize), String> {
        let permit = match semaphore.inner().clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => return Err("ALREADY_INDEXING".to_string()),
        };

        let cfg = read_config(&state);
        let session_state_dir = cfg.session_state_dir();
        let index_path = cfg.index_db_path();
        let app_handle = app.clone();

        let _ = app.emit("indexing-started", ());

        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let start = std::time::Instant::now();
            let app_fallback = app_handle.clone();
            let res = match tracepilot_indexer::reindex_incremental_with_rich_progress(
                &session_state_dir,
                &index_path,
                |progress| {
                    emit_indexing_progress(&app_handle, progress);
                },
            ) {
                Ok((indexed, skipped)) => Ok((indexed, indexed + skipped)),
                Err(_) => tracepilot_indexer::reindex_all_with_rich_progress(
                    &session_state_dir,
                    &index_path,
                    |progress| {
                        emit_indexing_progress(&app_fallback, progress);
                    },
                )
                .map(|n| (n, n))
                .map_err(|e| e.to_string()),
            };
            tracing::debug!(elapsed_ms = start.elapsed().as_millis(), "reindex_sessions Phase 1 wall time");
            res
        })
        .await
        .map_err(|e| e.to_string());

        let _ = app.emit("indexing-finished", ());

        // Phase 2: Kick off search content indexing in background (non-blocking).
        // Only triggers if Phase 1 succeeded. Uses try_acquire — if search is already running, skip.
        if result.as_ref().map(|r| r.is_ok()).unwrap_or(false) {
            let search_permit = search_semaphore.0.clone().try_acquire_owned();
            if let Ok(search_permit) = search_permit {
                let cfg2 = read_config(&state);
                let session_state_dir2 = cfg2.session_state_dir();
                let index_path2 = cfg2.index_db_path();
                let app2 = app.clone();
                tokio::task::spawn_blocking(move || {
                    let _permit = search_permit;
                    let start = std::time::Instant::now();
                    let _ = app2.emit("search-indexing-started", ());
                    match tracepilot_indexer::reindex_search_content(
                        &session_state_dir2,
                        &index_path2,
                        |progress| {
                            let _ = app2.emit(
                                "search-indexing-progress",
                                serde_json::json!({
                                    "current": progress.current,
                                    "total": progress.total
                                }),
                            );
                        },
                        || false,
                    ) {
                        Ok((indexed, skipped)) => {
                            tracing::debug!(indexed, skipped, elapsed_ms = start.elapsed().as_millis(), "reindex_sessions Phase 2 wall time");
                            let _ = app2.emit("search-indexing-finished", serde_json::json!({"success": true}));
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "Phase 2 search indexing failed");
                            let _ = app2.emit("search-indexing-finished", serde_json::json!({"success": false, "error": e.to_string()}));
                        }
                    }
                });
            }
        }

        result?
    }

    /// Full reindex: delete the index DB and rebuild from scratch.
    /// Returns (rebuilt, total) session counts.
    #[tauri::command]
    pub async fn reindex_sessions_full(
        state: tauri::State<'_, SharedConfig>,
        semaphore: tauri::State<'_, Arc<Semaphore>>,
        search_semaphore: tauri::State<'_, SearchSemaphore>,
        app: tauri::AppHandle,
    ) -> Result<(usize, usize), String> {
        // Non-blocking: reject duplicate rebuilds instead of queuing them
        let permit = match semaphore.inner().clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => return Err("ALREADY_INDEXING".to_string()),
        };

        let cfg = read_config(&state);
        let session_state_dir = cfg.session_state_dir();
        let index_path = cfg.index_db_path();
        let app_handle = app.clone();

        let _ = app.emit("indexing-started", ());

        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;

            // Delete existing DB to force a clean rebuild
            if index_path.exists() {
                let _ = std::fs::remove_file(&index_path);
                // Also remove WAL/SHM files if present
                let wal = index_path.with_extension("db-wal");
                let shm = index_path.with_extension("db-shm");
                let _ = std::fs::remove_file(&wal);
                let _ = std::fs::remove_file(&shm);
            }

            tracepilot_indexer::reindex_all_with_rich_progress(
                &session_state_dir,
                &index_path,
                |progress| {
                    emit_indexing_progress(&app_handle, progress);
                },
            )
            .map(|n| (n, n))
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string());

        let _ = app.emit("indexing-finished", ());

        // Phase 2: Kick off search content indexing in background (non-blocking).
        // After a full rebuild, search content must be rebuilt from scratch too.
        // Only triggers if Phase 1 succeeded.
        if result.as_ref().map(|r| r.is_ok()).unwrap_or(false) {
            let search_permit = search_semaphore.0.clone().try_acquire_owned();
            if let Ok(search_permit) = search_permit {
                let cfg2 = read_config(&state);
                let session_state_dir2 = cfg2.session_state_dir();
                let index_path2 = cfg2.index_db_path();
                let app2 = app.clone();
                tokio::task::spawn_blocking(move || {
                    let _permit = search_permit;
                    let start = std::time::Instant::now();
                    let _ = app2.emit("search-indexing-started", ());
                    match tracepilot_indexer::rebuild_search_content(
                        &session_state_dir2,
                        &index_path2,
                        |progress| {
                            let _ = app2.emit(
                                "search-indexing-progress",
                                serde_json::json!({
                                    "current": progress.current,
                                    "total": progress.total
                                }),
                            );
                        },
                        || false,
                    ) {
                        Ok((indexed, skipped)) => {
                            tracing::debug!(indexed, skipped, elapsed_ms = start.elapsed().as_millis(), "rebuild_search_index Phase 2 wall time");
                            let _ = app2.emit("search-indexing-finished", serde_json::json!({"success": true}));
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "Phase 2 search rebuild failed");
                            let _ = app2.emit("search-indexing-finished", serde_json::json!({"success": false, "error": e.to_string()}));
                        }
                    }
                });
            }
        }

        result?
    }

    // ── Deep Search Commands ──────────────────────────────────────────

    /// Search session content with full-text search or browse mode
    /// (filter-only, no query required).
    #[tauri::command]
    pub async fn search_content(
        state: tauri::State<'_, SharedConfig>,
        query: String,
        content_types: Option<Vec<String>>,
        repositories: Option<Vec<String>>,
        tool_names: Option<Vec<String>>,
        session_id: Option<String>,
        date_from_unix: Option<i64>,
        date_to_unix: Option<i64>,
        limit: Option<usize>,
        offset: Option<usize>,
        sort_by: Option<String>,
    ) -> Result<SearchResultsResponse, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();
        let query_for_closure = query.clone();

        tokio::task::spawn_blocking(move || {
            let start = std::time::Instant::now();
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;

            let filters = tracepilot_indexer::SearchFilters {
                content_types: content_types.unwrap_or_default(),
                repositories: repositories.unwrap_or_default(),
                tool_names: tool_names.unwrap_or_default(),
                session_id,
                date_from_unix,
                date_to_unix,
                limit,
                offset,
                sort_by,
            };

            let is_empty_query = query_for_closure.trim().is_empty();

            let (results, total_count) = if is_empty_query {
                // Browse mode: filter-only, no FTS MATCH
                let results = db.browse_content(&filters).map_err(|e| e.to_string())?;
                let total = db.browse_content_count(&filters).map_err(|e| e.to_string())?;
                (results, total)
            } else {
                // Standard FTS search
                let results = db.search_content(&query_for_closure, &filters).map_err(|e| e.to_string())?;
                let total = db.search_content_count(&query_for_closure, &filters).map_err(|e| e.to_string())?;
                (results, total)
            };

            let latency_ms = start.elapsed().as_secs_f64() * 1000.0;

            let page_limit = filters.limit.unwrap_or(50).min(200) as i64;
            let page_offset = filters.offset.unwrap_or(0) as i64;
            let has_more = (page_offset + page_limit) < total_count;

            Ok::<SearchResultsResponse, String>(SearchResultsResponse {
                results: results
                    .into_iter()
                    .map(|r| SearchResultItem {
                        id: r.id,
                        session_id: r.session_id,
                        content_type: r.content_type,
                        turn_number: r.turn_number,
                        event_index: r.event_index,
                        timestamp_unix: r.timestamp_unix,
                        tool_name: r.tool_name,
                        snippet: r.snippet,
                        metadata_json: r.metadata_json,
                        session_summary: r.session_summary,
                        session_repository: r.session_repository,
                        session_branch: r.session_branch,
                        session_updated_at: r.session_updated_at,
                    })
                    .collect(),
                total_count,
                has_more,
                query: query_for_closure,
                latency_ms,
            })
        })
        .await
        .map_err(|e: tokio::task::JoinError| e.to_string())?
    }

    /// Get facet counts — with a query for result-scoped facets, or without for global/browse facets.
    #[tauri::command]
    pub async fn get_search_facets(
        state: tauri::State<'_, SharedConfig>,
        query: Option<String>,
        content_types: Option<Vec<String>>,
        repositories: Option<Vec<String>>,
        tool_names: Option<Vec<String>>,
        session_id: Option<String>,
        date_from_unix: Option<i64>,
        date_to_unix: Option<i64>,
    ) -> Result<SearchFacetsResponse, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;

            let filters = tracepilot_indexer::SearchFilters {
                content_types: content_types.unwrap_or_default(),
                repositories: repositories.unwrap_or_default(),
                tool_names: tool_names.unwrap_or_default(),
                session_id,
                date_from_unix,
                date_to_unix,
                ..Default::default()
            };

            let facets = match query.as_deref() {
                Some(q) if !q.trim().is_empty() => {
                    db.search_facets(q, &filters).map_err(|e| e.to_string())?
                }
                _ => {
                    // Browse mode or no query — use browse_facets for filter-scoped counts
                    db.browse_facets(&filters).map_err(|e| e.to_string())?
                }
            };

            Ok(SearchFacetsResponse {
                by_content_type: facets.by_content_type,
                by_repository: facets.by_repository,
                by_tool_name: facets.by_tool_name,
                total_matches: facets.total_matches,
                session_count: facets.session_count,
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Get search index statistics.
    #[tauri::command]
    pub async fn get_search_stats(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<SearchStatsResponse, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;

            let stats = db.search_stats().map_err(|e| e.to_string())?;

            Ok(SearchStatsResponse {
                total_rows: stats.total_rows,
                indexed_sessions: stats.indexed_sessions,
                total_sessions: stats.total_sessions,
                content_type_counts: stats.content_type_counts,
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Get distinct repositories for search filter dropdown.
    #[tauri::command]
    pub async fn get_search_repositories(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<Vec<String>, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;
            db.search_repositories().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Get distinct tool names for search filter dropdown.
    #[tauri::command]
    pub async fn get_search_tool_names(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<Vec<String>, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();

        tokio::task::spawn_blocking(move || {
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;
            db.search_tool_names().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Rebuild the search index from scratch.
    #[tauri::command]
    pub async fn rebuild_search_index(
        state: tauri::State<'_, SharedConfig>,
        semaphore: tauri::State<'_, Arc<Semaphore>>,
        search_semaphore: tauri::State<'_, SearchSemaphore>,
        app: tauri::AppHandle,
    ) -> Result<(usize, usize), String> {
        // Reject if main indexing is currently running
        if semaphore.inner().available_permits() == 0 {
            return Err("ALREADY_INDEXING".to_string());
        }
        let permit = match search_semaphore.0.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => return Err("ALREADY_INDEXING".to_string()),
        };

        let cfg = read_config(&state);
        let session_state_dir = cfg.session_state_dir();
        let index_path = cfg.index_db_path();
        let app_handle = app.clone();

        let _ = app.emit("search-indexing-started", ());

        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            tracepilot_indexer::rebuild_search_content(
                &session_state_dir,
                &index_path,
                |progress| {
                    let _ = app_handle.emit(
                        "search-indexing-progress",
                        serde_json::json!({
                            "current": progress.current,
                            "total": progress.total
                        }),
                    );
                },
                || false, // Not cancellable from UI during manual rebuild
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string());

        let success = result.as_ref().map(|r| r.is_ok()).unwrap_or(false);
        let _ = app.emit("search-indexing-finished", serde_json::json!({"success": success}));
        result?
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
        hide_empty: Option<bool>,
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
                    hide_empty.unwrap_or(false),
                ) {
                    Ok(result) => return Ok(result),
                    Err(e) => tracing::warn!("Analytics SQL fast path failed, falling back to disk scan: {e}"),
                }
            }

            // Fallback: disk scan + in-memory computation (uses full session loading to include turns)
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                &session_state_dir,
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
                hide_empty.unwrap_or(false),
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
        hide_empty: Option<bool>,
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
                    hide_empty.unwrap_or(false),
                ) {
                    Ok(result) => return Ok(result),
                    Err(e) => tracing::warn!("Tool analysis SQL fast path failed, falling back to disk scan: {e}"),
                }
            }

            // Fallback: disk scan + in-memory computation
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                &session_state_dir,
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
                hide_empty.unwrap_or(false),
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
        hide_empty: Option<bool>,
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
                    hide_empty.unwrap_or(false),
                ) {
                    Ok(result) => return Ok(result),
                    Err(e) => tracing::warn!("Code impact SQL fast path failed, falling back to disk scan: {e}"),
                }
            }

            // Fallback: disk scan + in-memory computation
            let inputs = tracepilot_core::analytics::load_session_summaries_filtered(
                &session_state_dir,
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
                hide_empty.unwrap_or(false),
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
        tokio::task::spawn_blocking(|| Ok(config::config_file_path().is_some_and(|p| p.exists())))
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

    /// Check if a session is currently running by looking for `inuse.*.lock` files.
    #[tauri::command]
    pub async fn is_session_running(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
    ) -> Result<bool, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            Ok(tracepilot_core::session::discovery::has_lock_file(&path))
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
            if let Some(ref path) = config_path {
                let _ = std::fs::remove_file(path);
            }
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| e.to_string())??;

        // Clear shared state
        let mut guard = state.write().unwrap();
        *guard = None;
        Ok(())
    }

    /// Lazy-load the full result payload for a specific tool call.
    ///
    /// Tool result previews in `TurnToolCall.result_content` are truncated to 1 KB.
    /// This command returns the complete `result` field from the matching
    /// `tool.execution_complete` event, allowing the frontend to fetch it on demand.
    #[tauri::command]
    pub async fn get_tool_result(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
        tool_call_id: String,
    ) -> Result<Option<serde_json::Value>, String> {
        let session_state_dir = read_config(&state).session_state_dir();

        tokio::task::spawn_blocking(move || {
            let path = tracepilot_core::session::discovery::resolve_session_path_in(
                &session_id,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let events_path = path.join("events.jsonl");
            let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)
                .map_err(|e| e.to_string())?
                .events;

            // Return the last matching completion event (latest wins for duplicate completions)
            let mut last_result: Option<serde_json::Value> = None;
            for event in &events {
                if let tracepilot_core::parsing::events::TypedEventData::ToolExecutionComplete(
                    ref data,
                ) = event.typed_data
                {
                    if data.tool_call_id.as_deref() == Some(&tool_call_id) {
                        last_result = data.result.clone();
                    }
                }
            }
            Ok(last_result)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Open a new terminal window and run the configured CLI resume command.
    ///
    /// The terminal opens in the session's original working directory (from
    /// workspace.yaml) so the resumed CLI has the correct project context.
    #[tauri::command]
    pub async fn resume_session_in_terminal(
        state: tauri::State<'_, SharedConfig>,
        session_id: String,
        cli_command: Option<String>,
    ) -> Result<(), String> {
        // Validate UUID format to prevent command injection
        uuid::Uuid::parse_str(&session_id)
            .map_err(|_| "Invalid session ID format".to_string())?;

        let cli = cli_command.unwrap_or_else(|| "copilot".to_string());

        // Sanitize CLI command: allow only alphanumeric, hyphens, underscores, dots, slashes, and spaces
        if !cli.chars().all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c)) {
            return Err("CLI command contains invalid characters".to_string());
        }

        // Resolve the session's original working directory from workspace.yaml
        let session_state_dir = read_config(&state).session_state_dir();
        let sid = session_id.clone();
        let session_cwd = tokio::task::spawn_blocking(move || {
            let session_path = tracepilot_core::session::discovery::resolve_session_path_in(
                &sid,
                &session_state_dir,
            )
            .map_err(|e| e.to_string())?;
            let workspace_path = session_path.join("workspace.yaml");
            let metadata = tracepilot_core::parsing::workspace::parse_workspace_yaml(&workspace_path)
                .map_err(|e| e.to_string())?;
            Ok::<Option<std::path::PathBuf>, String>(
                metadata.cwd.map(std::path::PathBuf::from),
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        // Find a valid directory for the terminal: session CWD > its closest ancestor > home
        let effective_cwd = session_cwd
            .as_ref()
            .and_then(|p| {
                if p.is_dir() {
                    return Some(p.clone());
                }
                // Walk up to find the closest ancestor that exists
                let mut ancestor = p.parent();
                while let Some(dir) = ancestor {
                    if dir.is_dir() {
                        return Some(dir.to_path_buf());
                    }
                    ancestor = dir.parent();
                }
                None
            })
            .or_else(|| {
                std::env::var("USERPROFILE")
                    .or_else(|_| std::env::var("HOME"))
                    .ok()
                    .map(std::path::PathBuf::from)
                    .filter(|p| p.is_dir())
            })
            .unwrap_or_else(|| std::path::PathBuf::from("."));

        let cmd = format!("{} --resume {}", cli, session_id);

        #[cfg(windows)]
        {
            let escaped_cwd = effective_cwd.display().to_string().replace('\'', "''");
            let ps_cmd = format!(
                "$host.UI.RawUI.WindowTitle = 'Copilot Session (Resume)'; Set-Location -LiteralPath '{}'; Write-Host 'Resuming Copilot session...' -ForegroundColor Cyan; Write-Host '  Session: {}' -ForegroundColor White; Write-Host ''; {}",
                escaped_cwd,
                session_id,
                cmd.replace('\'', "''")
            );

            let encoded = tracepilot_orchestrator::process::encode_powershell_command(&ps_cmd);
            tracepilot_orchestrator::process::spawn_detached_terminal(
                "powershell",
                &["-NoExit", "-EncodedCommand", &encoded],
                &effective_cwd,
                None,
            )
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
        }

        #[cfg(not(windows))]
        {
            tracepilot_orchestrator::process::spawn_detached_terminal(
                &cmd, &[], &effective_cwd, None,
            )
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
        }

        Ok(())
    }

    // ── Update Detection Commands ────────────────────────────────

    /// Returns the installation type: "source", "installed", or "portable".
    /// - "source": debug/dev build (running via `tauri dev`)
    /// - "installed": NSIS installer location (supports auto-update)
    /// - "portable": standalone exe (manual update only)
    #[tauri::command]
    pub fn get_install_type() -> String {
        if cfg!(debug_assertions) {
            return "source".to_string();
        }
        if let Ok(exe) = std::env::current_exe() {
            let path = exe.to_string_lossy().to_lowercase();
            // NSIS installs to %LOCALAPPDATA%\{identifier}\
            if path.contains("appdata") && path.contains("dev.tracepilot.app") {
                return "installed".to_string();
            }
        }
        "portable".to_string()
    }

    #[tauri::command]
    pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
        let current_str = env!("CARGO_PKG_VERSION");
        let current = semver::Version::parse(current_str).map_err(|e| e.to_string())?;

        let client = reqwest::Client::builder()
            .user_agent(format!("TracePilot/{current_str}"))
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;

        let response = client
            .get("https://api.github.com/repos/MattShelton04/TracePilot/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;

        match response.status().as_u16() {
            404 => {
                return Ok(UpdateCheckResult {
                    current_version: current_str.to_string(),
                    latest_version: None,
                    has_update: false,
                    release_url: None,
                    published_at: None,
                })
            }
            429 | 403 => {
                return Err("GitHub API rate limit reached. Try again later.".into())
            }
            s if s >= 500 => return Err(format!("GitHub API error: HTTP {s}")),
            _ => {}
        }

        let release: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Parse error: {e}"))?;

        let latest_str = release["tag_name"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches('v');

        let has_update = semver::Version::parse(latest_str)
            .map(|latest| latest > current)
            .unwrap_or(false);

        Ok(UpdateCheckResult {
            current_version: current_str.to_string(),
            latest_version: Some(latest_str.to_string()),
            has_update,
            release_url: release["html_url"].as_str().map(String::from),
            published_at: release["published_at"].as_str().map(String::from),
        })
    }

    #[tauri::command]
    pub async fn get_git_info() -> GitInfo {
        let run = |args: &[&str]| -> Option<String> {
            tracepilot_orchestrator::process::run_hidden("git", args, None)
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        GitInfo {
            commit_hash: run(&["rev-parse", "--short", "HEAD"]),
            branch: run(&["rev-parse", "--abbrev-ref", "HEAD"]),
        }
    }

    // ─── Orchestration Commands ───────────────────────────────────────

    fn copilot_home() -> Result<std::path::PathBuf, String> {
        tracepilot_orchestrator::launcher::copilot_home().map_err(|e| e.to_string())
    }

    fn validate_path_within(path: &str, dir: &std::path::Path) -> Result<(), String> {
        let p = std::path::Path::new(path);
        if !p.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
        let canonical = p.canonicalize().map_err(|e| e.to_string())?;
        let canonical_dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        if !canonical.starts_with(&canonical_dir) {
            return Err("Path is outside the allowed directory".to_string());
        }
        Ok(())
    }

    // -- System dependencies --

    #[tauri::command]
    pub async fn check_system_deps() -> Result<tracepilot_orchestrator::SystemDependencies, String> {
        Ok(tokio::task::spawn_blocking(tracepilot_orchestrator::launcher::check_dependencies)
            .await
            .map_err(|e| e.to_string())?)
    }

    // -- Worktree commands --

    #[tauri::command]
    pub async fn list_worktrees(
        repo_path: String,
    ) -> Result<Vec<tracepilot_orchestrator::WorktreeInfo>, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::list_worktrees(std::path::Path::new(&repo_path))
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn create_worktree(
        request: tracepilot_orchestrator::CreateWorktreeRequest,
    ) -> Result<tracepilot_orchestrator::WorktreeInfo, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::create_worktree(&request)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn remove_worktree(
        repo_path: String,
        worktree_path: String,
        force: bool,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::remove_worktree(
                std::path::Path::new(&repo_path),
                std::path::Path::new(&worktree_path),
                force,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn prune_worktrees(
        repo_path: String,
    ) -> Result<tracepilot_orchestrator::PruneResult, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::prune_worktrees(std::path::Path::new(&repo_path))
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn list_branches(repo_path: String) -> Result<Vec<String>, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::list_branches(std::path::Path::new(&repo_path))
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_worktree_disk_usage(path: String) -> Result<u64, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::disk_usage_bytes(std::path::Path::new(&path))
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn is_git_repo(path: String) -> Result<bool, String> {
        Ok(tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::is_git_repo(std::path::Path::new(&path))
        })
        .await
        .map_err(|e| e.to_string())?)
    }

    #[tauri::command]
    pub async fn lock_worktree(
        repo_path: String,
        worktree_path: String,
        reason: Option<String>,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::lock_worktree(
                std::path::Path::new(&repo_path),
                std::path::Path::new(&worktree_path),
                reason.as_deref(),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn unlock_worktree(
        repo_path: String,
        worktree_path: String,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::unlock_worktree(
                std::path::Path::new(&repo_path),
                std::path::Path::new(&worktree_path),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_worktree_details(
        worktree_path: String,
    ) -> Result<tracepilot_orchestrator::WorktreeDetails, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::get_worktree_details(
                std::path::Path::new(&worktree_path),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_default_branch(repo_path: String) -> Result<String, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::get_default_branch(
                std::path::Path::new(&repo_path),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn fetch_remote(
        repo_path: String,
        branch: Option<String>,
    ) -> Result<String, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::worktrees::fetch_remote(
                std::path::Path::new(&repo_path),
                branch.as_deref(),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // -- Repository Registry commands --

    #[tauri::command]
    pub async fn list_registered_repos(
    ) -> Result<Vec<tracepilot_orchestrator::RegisteredRepo>, String> {
        tokio::task::spawn_blocking(
            tracepilot_orchestrator::repo_registry::list_registered_repos,
        )
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn add_registered_repo(
        path: String,
    ) -> Result<tracepilot_orchestrator::RegisteredRepo, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::repo_registry::add_repo(
                &path,
                tracepilot_orchestrator::RepoSource::Manual,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn remove_registered_repo(path: String) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::repo_registry::remove_repo(&path)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn discover_repos_from_sessions(
        state: tauri::State<'_, SharedConfig>,
    ) -> Result<Vec<tracepilot_orchestrator::RegisteredRepo>, String> {
        let cfg = read_config(&state);
        let index_path = cfg.index_db_path();

        // Query the index DB for distinct CWD paths
        let cwds = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
            if !index_path.exists() {
                return Ok(Vec::new());
            }
            let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&index_path)
                .map_err(|e| e.to_string())?;
            db.distinct_session_cwds().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        // Resolve to git roots and register
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::repo_registry::discover_repos_from_sessions(&cwds)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // -- Launcher commands --

    #[tauri::command]
    pub async fn launch_session(
        config: tracepilot_orchestrator::LaunchConfig,
    ) -> Result<tracepilot_orchestrator::LaunchedSession, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::launcher::launch_session(&config)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_available_models() -> Result<Vec<tracepilot_orchestrator::ModelInfo>, String> {
        Ok(tracepilot_orchestrator::launcher::available_models())
    }

    #[tauri::command]
    pub async fn open_in_explorer(path: String) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::launcher::open_in_explorer(&path)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn open_in_terminal(path: String) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::launcher::open_in_terminal(&path)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // -- Config Injector commands --

    #[tauri::command]
    pub async fn get_agent_definitions(
        version: Option<String>,
    ) -> Result<Vec<tracepilot_orchestrator::AgentDefinition>, String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            let version_dir = if let Some(v) = version {
                home.join("pkg").join("universal").join(v)
            } else {
                let active = tracepilot_orchestrator::version_manager::active_version(&home)
                    .map_err(|e| e.to_string())?;
                std::path::PathBuf::from(&active.path)
            };
            tracepilot_orchestrator::config_injector::read_agent_definitions(&version_dir)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn save_agent_definition(
        file_path: String,
        yaml_content: String,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::config_injector::write_agent_definition(
                std::path::Path::new(&file_path),
                &yaml_content,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_copilot_config() -> Result<tracepilot_orchestrator::CopilotConfig, String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            tracepilot_orchestrator::config_injector::read_copilot_config(&home)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn save_copilot_config(config: serde_json::Value) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            tracepilot_orchestrator::config_injector::write_copilot_config(&home, &config)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn create_config_backup(
        file_path: String,
        label: String,
    ) -> Result<tracepilot_orchestrator::BackupEntry, String> {
        tokio::task::spawn_blocking(move || {
            let backup_dir =
                tracepilot_orchestrator::config_injector::backup_dir().map_err(|e| e.to_string())?;
            tracepilot_orchestrator::config_injector::create_backup(
                std::path::Path::new(&file_path),
                &backup_dir,
                &label,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn list_config_backups() -> Result<Vec<tracepilot_orchestrator::BackupEntry>, String> {
        tokio::task::spawn_blocking(move || {
            let backup_dir =
                tracepilot_orchestrator::config_injector::backup_dir().map_err(|e| e.to_string())?;
            tracepilot_orchestrator::config_injector::list_backups(&backup_dir)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn restore_config_backup(
        backup_path: String,
        restore_to: String,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            // Validate backup_path is within backup directory
            let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()
                .map_err(|e| e.to_string())?;
            validate_path_within(&backup_path, &backup_dir)?;
            // Validate restore_to is within copilot home
            let copilot_home = copilot_home().map_err(|e| e.to_string())?;
            let restore_path = std::path::Path::new(&restore_to);
            if let Some(parent) = restore_path.parent() {
                if parent.exists() {
                    let canonical = parent.canonicalize().map_err(|e| e.to_string())?;
                    let canonical_home = copilot_home.canonicalize().unwrap_or(copilot_home);
                    if !canonical.starts_with(&canonical_home) {
                        return Err("Restore path is outside the Copilot directory".to_string());
                    }
                }
            }
            tracepilot_orchestrator::config_injector::restore_backup(
                std::path::Path::new(&backup_path),
                restore_path,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn delete_config_backup(backup_path: String) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::config_injector::delete_backup(
                std::path::Path::new(&backup_path),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn preview_backup_restore(
        backup_path: String,
        source_path: String,
    ) -> Result<tracepilot_orchestrator::BackupDiffPreview, String> {
        tokio::task::spawn_blocking(move || {
            let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()
                .map_err(|e| e.to_string())?;
            validate_path_within(&backup_path, &backup_dir)?;

            // Validate source_path is within the Copilot home directory
            let home = copilot_home()?;
            let source = std::path::Path::new(&source_path);
            if let Some(parent) = source.parent() {
                if parent.exists() {
                    let canonical = parent.canonicalize().map_err(|e| e.to_string())?;
                    let canonical_home = home.canonicalize().unwrap_or(home);
                    if !canonical.starts_with(&canonical_home) {
                        return Err(
                            "Source path is outside the Copilot directory".to_string(),
                        );
                    }
                }
            }

            tracepilot_orchestrator::config_injector::preview_backup_restore(
                std::path::Path::new(&backup_path),
                source,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn diff_config_files(
        old_path: String,
        new_path: String,
    ) -> Result<tracepilot_orchestrator::ConfigDiff, String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::config_injector::diff_files(
                std::path::Path::new(&old_path),
                std::path::Path::new(&new_path),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // -- Version Manager commands --

    #[tauri::command]
    pub async fn discover_copilot_versions(
    ) -> Result<Vec<tracepilot_orchestrator::CopilotVersion>, String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            tracepilot_orchestrator::version_manager::discover_versions(&home)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_active_copilot_version(
    ) -> Result<tracepilot_orchestrator::CopilotVersion, String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            tracepilot_orchestrator::version_manager::active_version(&home)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn get_migration_diffs(
        from_version: String,
        to_version: String,
    ) -> Result<Vec<tracepilot_orchestrator::MigrationDiff>, String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            tracepilot_orchestrator::version_manager::migration_diffs(
                &home,
                &from_version,
                &to_version,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn migrate_agent_definition(
        file_name: String,
        from_version: String,
        to_version: String,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            let home = copilot_home()?;
            tracepilot_orchestrator::version_manager::migrate_agent(
                &home,
                &file_name,
                &from_version,
                &to_version,
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // -- Template commands --

    #[tauri::command]
    pub async fn list_session_templates(
    ) -> Result<Vec<tracepilot_orchestrator::SessionTemplate>, String> {
        tokio::task::spawn_blocking(|| {
            tracepilot_orchestrator::templates::all_templates().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn save_session_template(
        template: tracepilot_orchestrator::SessionTemplate,
    ) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::templates::save_template(&template)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn delete_session_template(id: String) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::templates::delete_template(&id)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn restore_default_templates() -> Result<(), String> {
        tokio::task::spawn_blocking(|| {
            tracepilot_orchestrator::templates::restore_all_default_templates()
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn increment_template_usage(id: String) -> Result<(), String> {
        tokio::task::spawn_blocking(move || {
            tracepilot_orchestrator::templates::increment_usage(&id)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    // ── Logging commands ─────────────────────────────────────────

    #[tauri::command]
    pub async fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
        let log_dir = app
            .path()
            .app_log_dir()
            .map_err(|e: tauri::Error| e.to_string())?;
        Ok(log_dir.to_string_lossy().to_string())
    }

    #[tauri::command]
    pub async fn export_logs(
        app: tauri::AppHandle,
        destination: String,
    ) -> Result<String, String> {
        let log_dir = app
            .path()
            .app_log_dir()
            .map_err(|e: tauri::Error| e.to_string())?;

        tokio::task::spawn_blocking(move || {
            use std::io::Read;

            let dest = std::path::PathBuf::from(&destination);

            // Basic destination validation — must be absolute
            if !dest.is_absolute() {
                return Err("Destination path must be absolute".into());
            }

            if !log_dir.exists() {
                return Err("Log directory does not exist".into());
            }

            // Collect log files — include both .log extension and rotated files
            // (tauri-plugin-log names them TracePilot.log, TracePilot.log.1, etc.)
            let mut log_files: Vec<_> = std::fs::read_dir(&log_dir)
                .map_err(|e| format!("Failed to read log directory: {e}"))?
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    let path = entry.path();
                    let name = path.file_name()?.to_string_lossy().to_string();
                    if name.starts_with("TracePilot") && name.contains(".log") {
                        Some(path)
                    } else {
                        None
                    }
                })
                .collect();

            // Sort by modification time for correct chronological order
            log_files.sort_by_key(|f| {
                f.metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            });

            if log_files.is_empty() {
                return Err("No log files found".into());
            }

            // Size guard — refuse if total exceeds 50MB
            let total_size: u64 = log_files
                .iter()
                .filter_map(|f| f.metadata().ok())
                .map(|m| m.len())
                .sum();
            if total_size > 50_000_000 {
                return Err(format!(
                    "Log files total {:.1}MB — too large to export. Clear old logs first.",
                    total_size as f64 / 1_000_000.0
                ));
            }

            // Concatenate with Windows-safe file reading
            let mut combined = String::new();
            let mut exported_count = 0usize;
            for file in &log_files {
                let mut opts = std::fs::OpenOptions::new();
                opts.read(true);
                #[cfg(windows)]
                {
                    use std::os::windows::fs::OpenOptionsExt;
                    // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
                    // Includes DELETE so log rotation can rename files during export
                    opts.share_mode(7);
                }
                match opts.open(file) {
                    Ok(mut f) => {
                        let mut content = String::new();
                        if f.read_to_string(&mut content).is_ok() {
                            combined.push_str(&format!(
                                "=== {} ===\n",
                                file.file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                            ));
                            combined.push_str(&content);
                            combined.push('\n');
                            exported_count += 1;
                        }
                    }
                    Err(_) => continue,
                }
            }

            if exported_count == 0 {
                return Err("Could not read any log files (all locked or unreadable)".into());
            }

            std::fs::write(&dest, &combined)
                .map_err(|e| format!("Failed to write export: {e}"))?;

            let msg = if exported_count < log_files.len() {
                format!(
                    "Exported {} of {} log file(s) to {} ({} skipped)",
                    exported_count,
                    log_files.len(),
                    dest.display(),
                    log_files.len() - exported_count
                )
            } else {
                format!(
                    "Exported {} log file(s) to {}",
                    exported_count,
                    dest.display()
                )
            };
            Ok(msg)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// Get the plugin to register all commands.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .setup(|app, _api| {
            app.manage(std::sync::Arc::new(tokio::sync::Semaphore::new(1)));
            app.manage(SearchSemaphore(std::sync::Arc::new(
                tokio::sync::Semaphore::new(1),
            )));
            let turn_cache: TurnCache = Arc::new(Mutex::new(lru::LruCache::new(
                NonZeroUsize::new(10).unwrap(),
            )));
            app.manage(turn_cache);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::get_session_detail,
            commands::get_session_incidents,
            commands::get_session_turns,
            commands::check_session_freshness,
            commands::get_session_events,
            commands::get_session_todos,
            commands::get_session_checkpoints,
            commands::get_session_plan,
            commands::get_shutdown_metrics,
            commands::search_sessions,
            commands::search_content,
            commands::get_search_facets,
            commands::get_search_stats,
            commands::get_search_repositories,
            commands::get_search_tool_names,
            commands::rebuild_search_index,
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
            commands::is_session_running,
            commands::factory_reset,
            commands::get_tool_result,
            commands::resume_session_in_terminal,
            commands::check_for_updates,
            commands::get_install_type,
            commands::get_git_info,
            // Orchestration commands
            commands::check_system_deps,
            commands::list_worktrees,
            commands::create_worktree,
            commands::remove_worktree,
            commands::prune_worktrees,
            commands::list_branches,
            commands::get_worktree_disk_usage,
            commands::is_git_repo,
            commands::lock_worktree,
            commands::unlock_worktree,
            commands::get_worktree_details,
            commands::get_default_branch,
            commands::fetch_remote,
            commands::list_registered_repos,
            commands::add_registered_repo,
            commands::remove_registered_repo,
            commands::discover_repos_from_sessions,
            commands::launch_session,
            commands::get_available_models,
            commands::open_in_explorer,
            commands::open_in_terminal,
            commands::get_agent_definitions,
            commands::save_agent_definition,
            commands::get_copilot_config,
            commands::save_copilot_config,
            commands::create_config_backup,
            commands::list_config_backups,
            commands::restore_config_backup,
            commands::delete_config_backup,
            commands::preview_backup_restore,
            commands::diff_config_files,
            commands::discover_copilot_versions,
            commands::get_active_copilot_version,
            commands::get_migration_diffs,
            commands::migrate_agent_definition,
            commands::list_session_templates,
            commands::save_session_template,
            commands::delete_session_template,
            commands::restore_default_templates,
            commands::increment_template_usage,
            // Logging commands
            commands::get_log_path,
            commands::export_logs,
        ])
        .build()
}
