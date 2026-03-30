//! Session-related Tauri commands (12 commands).

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{
    load_summary_list_item, read_config, with_session_path,
    MAX_CHECKPOINT_CONTENT_BYTES,
};
use crate::types::{
    CachedTurns, EventItem, EventsResponse, FreshnessResponse, SessionIncidentItem,
    SessionListItem, TodosResponse, TurnCache, TurnsResponse,
};

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_sessions(
    state: tauri::State<'_, SharedConfig>,
    limit: Option<u32>,
    repo: Option<String>,
    branch: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<Vec<SessionListItem>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        // Fast path: query the index DB (single SQLite read, no per-session I/O)
        if index_path.exists() {
            let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;

            // Check if index has any sessions; if empty, fall through to disk scan
            let count = db.session_count().unwrap_or(0);
            if count > 0 {
                let indexed = db
                    .list_sessions(
                        limit.map(|l| l as usize),
                        repo.as_deref(),
                        branch.as_deref(),
                        hide_empty.unwrap_or(false),
                    )?;

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
            tracepilot_core::session::discovery::discover_sessions(&session_state_dir)?;

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
    .await?
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_detail(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<tracepilot_core::SessionSummary> {
    with_session_path(&state, session_id, |path| {
        Ok(tracepilot_core::summary::load_session_summary(&path)?)
    })
    .await
}

#[tauri::command]
pub async fn get_session_incidents(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<SessionIncidentItem>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    tokio::task::spawn_blocking(move || {
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let incidents = db
            .get_session_incidents(&session_id)?;
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
    .await?
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_turns(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, TurnCache>,
    session_id: String,
) -> CmdResult<TurnsResponse> {
    let session_state_dir = read_config(&state).session_state_dir();
    let cache = cache.inner().clone();

    tokio::task::spawn_blocking(move || {
        let path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;
        let events_path = path.join("events.jsonl");

        let file_size = std::fs::metadata(&events_path)
            .map(|m| m.len())
            .unwrap_or(0);

        // Check LRU cache — return if file size unchanged (append-only).
        // Clone cache data and release lock before running prepare_turns_for_ipc
        // to minimise Mutex hold time on concurrent IPC requests.
        let cached_turns = {
            let Ok(mut lru) = cache.lock() else {
                tracing::warn!("Turn cache Mutex poisoned — skipping cache read");
                let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)?
                    .events;
                let turns = tracepilot_core::turns::reconstruct_turns(&events);
                let mut ipc_turns = turns;
                tracepilot_core::turns::prepare_turns_for_ipc(&mut ipc_turns);
                return Ok(TurnsResponse {
                    turns: ipc_turns,
                    events_file_size: file_size,
                });
            };
            lru.get(&session_id)
                .filter(|cached| cached.events_file_size == file_size)
                .map(|cached| cached.turns.clone())
        };

        if let Some(mut turns) = cached_turns {
            tracepilot_core::turns::prepare_turns_for_ipc(&mut turns);
            return Ok(TurnsResponse {
                turns,
                events_file_size: file_size,
            });
        }

        // Cache miss or stale — parse from disk
        let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)?
            .events;
        let turns = tracepilot_core::turns::reconstruct_turns(&events);

        // Store full (untrimmed) turns in LRU
        if let Ok(mut lru) = cache.lock() {
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
    .await?
}

/// Lightweight freshness probe— returns just the events.jsonl file size.
#[tauri::command]
pub async fn check_session_freshness(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<FreshnessResponse> {
    with_session_path(&state, session_id, |path| {
        let file_size = std::fs::metadata(path.join("events.jsonl"))
            .map(|m| m.len())
            .unwrap_or(0);
        Ok(FreshnessResponse { events_file_size: file_size })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_events(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    offset: Option<u32>,
    limit: Option<u32>,
    event_type: Option<String>,
) -> CmdResult<EventsResponse> {
    with_session_path(&state, session_id, move |path| {
        let events_path = path.join("events.jsonl");
        let all_events = tracepilot_core::parsing::events::parse_typed_events(&events_path)?
            .events;

        let all_event_types: Vec<String> = {
            let mut types = std::collections::BTreeSet::new();
            for event in &all_events {
                types.insert(event.event_type.to_string());
            }
            types.into_iter().collect()
        };

        let events: Vec<_> = if let Some(ref filter_type) = event_type {
            all_events
                .iter()
                .filter(|e| &e.event_type.to_string() == filter_type)
                .collect()
        } else {
            all_events.iter().collect()
        };

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
            all_event_types,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_session_todos(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<TodosResponse> {
    with_session_path(&state, session_id, |path| {
        let db_path = path.join("session.db");
        let todos = tracepilot_core::parsing::session_db::read_todos(&db_path)?;
        let deps = tracepilot_core::parsing::session_db::read_todo_deps(&db_path)?;
        Ok(TodosResponse { todos, deps })
    })
    .await
}

#[tauri::command]
pub async fn get_session_checkpoints(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<tracepilot_core::parsing::checkpoints::CheckpointEntry>> {
    with_session_path(&state, session_id, |path| {
        let mut checkpoints = tracepilot_core::parsing::checkpoints::parse_checkpoints(&path)?
            .map(|index| index.checkpoints)
            .unwrap_or_default();

        for checkpoint in &mut checkpoints {
            if let Some(content) = checkpoint.content.as_mut() {
                tracepilot_core::utils::truncate_string_utf8(content, MAX_CHECKPOINT_CONTENT_BYTES);
            }
        }

        Ok(checkpoints)
    })
    .await
}

#[tauri::command]
pub async fn get_session_plan(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Option<serde_json::Value>> {
    with_session_path(&state, session_id, |path| {
        let plan_path = path.join("plan.md");
        if !plan_path.exists() {
            return Ok(None);
        }

        let mut content = std::fs::read_to_string(&plan_path)?;
        tracepilot_core::utils::truncate_string_utf8(&mut content, MAX_CHECKPOINT_CONTENT_BYTES);

        Ok(Some(serde_json::json!({ "content": content })))
    })
    .await
}

#[tauri::command]
pub async fn get_shutdown_metrics(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Option<tracepilot_core::models::event_types::ShutdownData>> {
    with_session_path(&state, session_id, |path| {
        let events_path = path.join("events.jsonl");
        let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)?
            .events;
        Ok(tracepilot_core::parsing::events::extract_combined_shutdown_data(
            &events,
        )
        .map(|(data, _count)| data))
    })
    .await
}

/// Lazy-load the full result payload for a specific tool call.
#[tauri::command]
pub async fn get_tool_result(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    tool_call_id: String,
) -> CmdResult<Option<serde_json::Value>> {
    with_session_path(&state, session_id, move |path| {
        let events_path = path.join("events.jsonl");
        let events = tracepilot_core::parsing::events::parse_typed_events(&events_path)?
            .events;

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
}

/// Open a new terminal window and run the configured CLI resume command.
#[tauri::command]
pub async fn resume_session_in_terminal(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    cli_command: Option<String>,
) -> CmdResult<()> {
    // Validate UUID format to prevent command injection
    uuid::Uuid::parse_str(&session_id)
        .map_err(|_| BindingsError::Validation("Invalid session ID format".into()))?;

    let cli = cli_command.unwrap_or_else(|| "copilot".to_string());

    // Sanitize CLI command: allow only alphanumeric, hyphens, underscores, dots, slashes, spaces.
    // Colon is needed for Windows drive letters (e.g., C:\path\to\copilot).
    if !cli.chars().all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c)) {
        return Err(BindingsError::Validation("CLI command contains invalid characters".into()));
    }

    // Resolve the session's original working directory from workspace.yaml
    let session_state_dir = read_config(&state).session_state_dir();
    let sid = session_id.clone();
    let session_cwd = tokio::task::spawn_blocking(move || {
        let session_path = tracepilot_core::session::discovery::resolve_session_path_in(
            &sid,
            &session_state_dir,
        )?;
        let workspace_path = session_path.join("workspace.yaml");
        let metadata = tracepilot_core::parsing::workspace::parse_workspace_yaml(&workspace_path)?;
        Ok::<Option<std::path::PathBuf>, BindingsError>(
            metadata.cwd.map(std::path::PathBuf::from),
        )
    })
    .await??;

    // Find a valid directory for the terminal: session CWD > its closest ancestor > home
    let effective_cwd = session_cwd
        .as_ref()
        .and_then(|p| {
            if p.is_dir() {
                return Some(p.clone());
            }
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
            tracepilot_core::utils::home_dir_opt()
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
        )?;
    }

    #[cfg(not(windows))]
    {
        tracepilot_orchestrator::process::spawn_detached_terminal(
            &cmd, &[], &effective_cwd, None,
        )?;
    }

    Ok(())
}
