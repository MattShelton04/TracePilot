//! Session-related Tauri commands (12 commands).

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{
    MAX_CHECKPOINT_CONTENT_BYTES, indexed_session_to_list_item, load_summary_list_item,
    read_config, with_session_path,
};
use crate::types::{
    CachedEvents, CachedTurns, EventCache, EventItem, EventsResponse, FreshnessResponse,
    SessionIncidentItem, SessionListItem, TodosResponse, TurnCache, TurnsResponse,
};
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

fn system_time_to_unix_millis(time: Option<SystemTime>) -> Option<i64> {
    time.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn load_cached_typed_events(
    cache: &EventCache,
    session_id: &str,
    events_path: &Path,
) -> Result<
    (
        Arc<Vec<tracepilot_core::parsing::events::TypedEvent>>,
        u64,
        Option<std::time::SystemTime>,
    ),
    BindingsError,
> {
    let meta = std::fs::metadata(events_path).ok();
    let file_size = meta.as_ref().map_or(0, |m| m.len());
    let file_mtime = meta.and_then(|m| m.modified().ok());

    let cached_events = match cache.lock() {
        Ok(mut lru) => lru
            .get(session_id)
            .filter(|cached| {
                cached.events_file_size == file_size && cached.events_file_mtime == file_mtime
            })
            .map(|cached| Arc::clone(&cached.events)),
        Err(_) => {
            tracing::warn!("Event cache Mutex poisoned — skipping cache read");
            None
        }
    };

    if let Some(events) = cached_events {
        return Ok((events, file_size, file_mtime));
    }

    let events =
        Arc::new(tracepilot_core::parsing::events::parse_typed_events(events_path)?.events);

    if let Ok(mut lru) = cache.lock() {
        lru.put(
            session_id.to_string(),
            CachedEvents {
                events: Arc::clone(&events),
                events_file_size: file_size,
                events_file_mtime: file_mtime,
            },
        );
    } else {
        tracing::warn!("Event cache Mutex poisoned — skipping cache write");
    }

    Ok((events, file_size, file_mtime))
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all)]
pub async fn list_sessions(
    state: tauri::State<'_, SharedConfig>,
    limit: Option<u32>,
    repo: Option<String>,
    branch: Option<String>,
    hide_empty: Option<bool>,
    hide_orchestrator: Option<bool>,
) -> CmdResult<Vec<SessionListItem>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();
    let exclude_cwd = if hide_orchestrator.unwrap_or(false) {
        Some(cfg.jobs_dir().to_string_lossy().to_string())
    } else {
        None
    };

    blocking_cmd!({
        // Fast path: query the index DB (single SQLite read, no per-session I/O)
        if index_path.exists() {
            let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;

            // Check if index has any sessions; if empty, fall through to disk scan
            let count = db.session_count().unwrap_or(0);
            if count > 0 {
                let indexed = db.list_sessions_filtered(
                    limit.map(|l| l as usize),
                    repo.as_deref(),
                    branch.as_deref(),
                    hide_empty.unwrap_or(false),
                    exclude_cwd.as_deref(),
                )?;

                return Ok(indexed
                    .into_iter()
                    .map(indexed_session_to_list_item)
                    .collect());
            }
        }

        // Fallback: full disk scan (used when index is empty or missing)
        let sessions = tracepilot_core::session::discovery::discover_sessions(&session_state_dir)?;

        let mut items = Vec::new();
        let should_hide_empty = hide_empty.unwrap_or(false);
        // Normalize the exclude_cwd prefix for comparison (forward slashes)
        let exclude_cwd_normalized = exclude_cwd.as_deref().map(|p| p.replace('\\', "/"));
        for session in sessions {
            let item = match load_summary_list_item(&session.path) {
                Ok(item) => item,
                Err(_) => continue,
            };

            // Apply CWD exclusion filter (same logic as SQL path in session_reader)
            if let Some(ref prefix) = exclude_cwd_normalized {
                if let Some(ref cwd) = item.cwd {
                    if cwd.replace('\\', "/").starts_with(prefix.as_str()) {
                        continue;
                    }
                }
            }

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

        Ok::<_, BindingsError>(items)
    })
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
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_incidents(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<SessionIncidentItem>> {
    crate::validators::validate_session_id(&session_id)?;

    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let incidents = db.get_session_incidents(&session_id)?;
        Ok::<_, BindingsError>(
            incidents
                .into_iter()
                .map(|i| SessionIncidentItem {
                    event_type: i.event_type,
                    source_event_type: i.source_event_type,
                    timestamp: i.timestamp,
                    severity: i.severity,
                    summary: i.summary,
                    detail_json: i.detail_json.and_then(|s| serde_json::from_str(&s).ok()),
                })
                .collect(),
        )
    })
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_turns(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, TurnCache>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<TurnsResponse> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();
    let cache = cache.inner().clone();
    let event_cache = event_cache.inner().clone();

    blocking_cmd!({
        let path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;
        let events_path = path.join("events.jsonl");

        // Check LRU cache — return if file size unchanged (append-only).
        // Clone cache data and release lock before running prepare_turns_for_ipc
        // to minimise Mutex hold time on concurrent IPC requests.
        let cached_turns = {
            let meta = std::fs::metadata(&events_path).ok();
            let file_size = meta.as_ref().map_or(0, |m| m.len());
            let file_mtime = meta.and_then(|m| m.modified().ok());
            let Ok(mut lru) = cache.lock() else {
                tracing::warn!("Turn cache Mutex poisoned — skipping cache read");
                let (events, events_file_size, events_file_mtime) =
                    load_cached_typed_events(&event_cache, &session_id, &events_path)?;
                let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());
                let mut ipc_turns = turns;
                tracepilot_core::turns::prepare_turns_for_ipc(&mut ipc_turns);
                return Ok(TurnsResponse {
                    turns: ipc_turns,
                    events_file_size,
                    events_file_mtime: system_time_to_unix_millis(events_file_mtime),
                });
            };
            (
                lru.get(&session_id)
                    .filter(|cached| {
                        cached.events_file_size == file_size
                            && cached.events_file_mtime == file_mtime
                    })
                    .map(|cached| cached.turns.clone()),
                file_size,
                file_mtime,
            )
        };

        if let (Some(mut turns), file_size, file_mtime) = cached_turns {
            tracepilot_core::turns::prepare_turns_for_ipc(&mut turns);
            return Ok(TurnsResponse {
                turns,
                events_file_size: file_size,
                events_file_mtime: system_time_to_unix_millis(file_mtime),
            });
        }

        // Cache miss or stale — parse from disk
        let (events, events_file_size, events_file_mtime) =
            load_cached_typed_events(&event_cache, &session_id, &events_path)?;
        let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());

        // Store full (untrimmed) turns in LRU
        if let Ok(mut lru) = cache.lock() {
            lru.put(
                session_id.clone(),
                CachedTurns {
                    turns: turns.clone(),
                    events_file_size,
                    events_file_mtime,
                },
            );
        }

        let mut ipc_turns = turns;
        tracepilot_core::turns::prepare_turns_for_ipc(&mut ipc_turns);
        Ok::<_, BindingsError>(TurnsResponse {
            turns: ipc_turns,
            events_file_size,
            events_file_mtime: system_time_to_unix_millis(events_file_mtime),
        })
    })
}

/// Lightweight freshness probe— returns just the events.jsonl file size.
#[tauri::command]
#[specta::specta]
pub async fn check_session_freshness(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<FreshnessResponse> {
    with_session_path(&state, session_id, |path| {
        let meta = std::fs::metadata(path.join("events.jsonl")).ok();
        let file_size = meta.as_ref().map_or(0, |m| m.len());
        let file_mtime = meta.and_then(|m| m.modified().ok());
        Ok(FreshnessResponse {
            events_file_size: file_size,
            events_file_mtime: system_time_to_unix_millis(file_mtime),
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_events(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, EventCache>,
    session_id: String,
    offset: Option<u32>,
    limit: Option<u32>,
    event_type: Option<String>,
) -> CmdResult<EventsResponse> {
    // Clamp explicit limit to a safe upper bound; None preserves "return all".
    let limit = crate::validators::clamp_limit(limit, crate::validators::MAX_EVENTS_PAGE_LIMIT);
    let cache = cache.inner().clone();
    let cache_session_id = session_id.clone();

    with_session_path(&state, session_id, move |path| {
        let events_path = path.join("events.jsonl");
        let (all_events, _, _) = load_cached_typed_events(&cache, &cache_session_id, &events_path)?;

        let all_event_types: Vec<String> = {
            let mut types = std::collections::BTreeSet::new();
            for event in all_events.iter() {
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
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
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
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
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
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
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
    cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<Option<tracepilot_core::models::event_types::ShutdownData>> {
    let cache = cache.inner().clone();
    let cache_session_id = session_id.clone();

    with_session_path(&state, session_id, move |path| {
        let events_path = path.join("events.jsonl");
        let (events, _, _) = load_cached_typed_events(&cache, &cache_session_id, &events_path)?;
        Ok(
            tracepilot_core::parsing::events::extract_combined_shutdown_data(events.as_ref())
                .map(|(data, _count)| data),
        )
    })
    .await
}

/// Lazy-load the full result payload for a specific tool call.
#[tauri::command]
pub async fn get_tool_result(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, EventCache>,
    session_id: String,
    tool_call_id: String,
) -> CmdResult<Option<serde_json::Value>> {
    let cache = cache.inner().clone();
    let cache_session_id = session_id.clone();

    with_session_path(&state, session_id, move |path| {
        let events_path = path.join("events.jsonl");
        let (events, _, _) = load_cached_typed_events(&cache, &cache_session_id, &events_path)?;

        let mut last_result: Option<serde_json::Value> = None;
        for event in events.iter() {
            if let tracepilot_core::parsing::events::TypedEventData::ToolExecutionComplete(
                ref data,
            ) = event.typed_data
                && data.tool_call_id.as_deref() == Some(&tool_call_id) {
                    last_result = data.result.clone();
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
    // Validate UUID format (also prevents command injection via session_id)
    crate::validators::validate_session_id(&session_id)?;

    let cli =
        cli_command.unwrap_or_else(|| tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string());

    // Sanitize CLI command: allow only alphanumeric, hyphens, underscores, dots, slashes, spaces.
    // Colon is needed for Windows drive letters (e.g., C:\path\to\copilot).
    if !cli
        .chars()
        .all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c))
    {
        return Err(BindingsError::Validation(
            "CLI command contains invalid characters".into(),
        ));
    }

    // Resolve the session's original working directory from workspace.yaml
    let session_state_dir = read_config(&state).session_state_dir();
    let sid = session_id.clone();
    let session_cwd = tokio::task::spawn_blocking(move || {
        let session_path =
            tracepilot_core::session::discovery::resolve_session_path_in(&sid, &session_state_dir)?;
        let workspace_path = session_path.join("workspace.yaml");
        let metadata = tracepilot_core::parsing::workspace::parse_workspace_yaml(&workspace_path)?;
        Ok::<Option<std::path::PathBuf>, BindingsError>(metadata.cwd.map(std::path::PathBuf::from))
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
        .or_else(|| tracepilot_core::utils::home_dir_opt().filter(|p| p.is_dir()))
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
        tracepilot_orchestrator::process::spawn_detached_terminal(&cmd, &[], &effective_cwd, None)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::num::NonZeroUsize;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    fn event_cache(capacity: usize) -> EventCache {
        Arc::new(Mutex::new(lru::LruCache::new(
            NonZeroUsize::new(capacity).expect("cache capacity is non-zero"),
        )))
    }

    fn append_event_line(
        events_path: &Path,
        event_type: &str,
        data: serde_json::Value,
        id: &str,
        timestamp: &str,
    ) {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(events_path)
            .expect("failed to open events.jsonl");
        write!(
            file,
            "\n{}",
            serde_json::to_string(&serde_json::json!({
                "type": event_type,
                "data": data,
                "id": id,
                "timestamp": timestamp,
            }))
            .expect("failed to serialize event")
        )
        .expect("failed to append event");
    }

    fn temp_session(events: &[(&str, serde_json::Value)]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("failed to create temp dir");
        let session_path = dir.path().to_path_buf();

        std::fs::write(
            session_path.join("workspace.yaml"),
            "id: test-session-00000000\nconversationMode: ask\n",
        )
        .expect("failed to write workspace.yaml");

        let events_path = session_path.join("events.jsonl");
        let mut file = std::fs::File::create(&events_path).expect("failed to create events.jsonl");

        for (index, (event_type, data)) in events.iter().enumerate() {
            if index > 0 {
                writeln!(file).expect("failed to add newline");
            }
            write!(
                file,
                "{}",
                serde_json::to_string(&serde_json::json!({
                    "type": event_type,
                    "data": data,
                    "id": format!("e{}", index + 1),
                    "timestamp": format!("2025-01-01T00:00:{index:02}.000Z"),
                }))
                .expect("failed to serialize event")
            )
            .expect("failed to write event");
        }

        (dir, session_path)
    }

    #[test]
    fn load_cached_typed_events_returns_cached_arc_on_hit() {
        let (_dir, session_path) = temp_session(&[
            ("session.start", serde_json::json!({ "cwd": "/repo" })),
            ("user.message", serde_json::json!({ "content": "hello" })),
        ]);
        let cache = event_cache(2);
        let events_path = session_path.join("events.jsonl");

        let (first, first_size, first_mtime) =
            load_cached_typed_events(&cache, "session-a", &events_path).expect("cache miss loads");
        let (second, second_size, second_mtime) =
            load_cached_typed_events(&cache, "session-a", &events_path).expect("cache hit loads");

        assert_eq!(first_size, second_size);
        assert_eq!(first_mtime, second_mtime);
        assert_eq!(first.len(), 2);
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn load_cached_typed_events_invalidates_stale_entries_when_file_changes() {
        let (_dir, session_path) = temp_session(&[
            ("session.start", serde_json::json!({ "cwd": "/repo" })),
            ("user.message", serde_json::json!({ "content": "hello" })),
        ]);
        let cache = event_cache(2);
        let events_path = session_path.join("events.jsonl");

        let (first, first_size, _first_mtime) =
            load_cached_typed_events(&cache, "session-a", &events_path).expect("initial load");

        append_event_line(
            &events_path,
            "tool.execution.complete",
            serde_json::json!({
                "toolCallId": "call-1",
                "success": true,
                "result": { "ok": true },
            }),
            "e3",
            "2025-01-01T00:00:02.000Z",
        );

        let (second, second_size, _second_mtime) =
            load_cached_typed_events(&cache, "session-a", &events_path)
                .expect("reload after append");

        assert!(second_size > first_size);
        assert_eq!(second.len(), 3);
        assert!(!Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn load_cached_typed_events_recovers_from_poisoned_mutex() {
        let (_dir, session_path) = temp_session(&[
            ("session.start", serde_json::json!({ "cwd": "/repo" })),
            ("user.message", serde_json::json!({ "content": "hello" })),
        ]);
        let cache = event_cache(2);
        let events_path = session_path.join("events.jsonl");

        let poisoned_cache = Arc::clone(&cache);
        let _ = std::thread::spawn(move || {
            let _guard = poisoned_cache.lock().expect("lock cache");
            panic!("poison cache");
        })
        .join();

        let (events, file_size, _mtime) =
            load_cached_typed_events(&cache, "session-a", &events_path).expect("poison fallback");

        assert_eq!(events.len(), 2);
        assert!(file_size > 0);
    }
}
