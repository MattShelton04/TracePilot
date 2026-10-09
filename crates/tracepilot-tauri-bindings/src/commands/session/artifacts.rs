//! Session artifact commands: todos, checkpoints, plan, background tasks.

use std::sync::{LazyLock, Mutex};

use lru::LruCache;
use tracepilot_core::provider::{BackgroundTask, ResolvedSession};

use super::shared::source_stamp;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{MAX_CHECKPOINT_CONTENT_BYTES, with_session_locator};
use crate::types::TodosResponse;

// A source without an artifact has nothing to show, so these read-only
// commands return it empty rather than refusing. They read Copilot's layout
// directly; a source that gains the capability routes through
// `SessionProvider::artifacts` (C13).

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_todos(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<TodosResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_todos {
            return Ok(TodosResponse {
                todos: Vec::new(),
                deps: Vec::new(),
            });
        }
        let db_path = session.locator.primary_path.join("session.db");
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
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_checkpoints {
            return Ok(Vec::new());
        }
        let path = &session.locator.primary_path;
        let mut checkpoints = tracepilot_core::parsing::checkpoints::parse_checkpoints(path)?
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
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_plan {
            return Ok(None);
        }
        let plan_path = session.locator.primary_path.join("plan.md");
        if !plan_path.exists() {
            return Ok(None);
        }

        let mut content = tracepilot_core::TracePilotError::read_to_string(&plan_path)?;
        tracepilot_core::utils::truncate_string_utf8(&mut content, MAX_CHECKPOINT_CONTENT_BYTES);

        Ok(Some(serde_json::json!({ "content": content })))
    })
    .await
}

/// Subagents and shells the session ran in the background. Empty for a
/// source that does not record them.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_session_background_tasks(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<BackgroundTask>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        background_tasks(&session, &BACKGROUND_TASKS)
    })
    .await
}

/// Background tasks per session with the source version they were read at.
type BackgroundTaskCache = Mutex<LruCache<String, (String, Vec<BackgroundTask>)>>;

/// A running session's detail view asks for its background tasks on every
/// refresh, and reading them re-reads every transcript, so they are reused
/// while the session's source version is unchanged.
static BACKGROUND_TASKS: LazyLock<BackgroundTaskCache> = LazyLock::new(|| {
    Mutex::new(crate::cache::build_session_lru(
        crate::config::DEFAULT_SESSION_CACHE_SIZE,
    ))
});

fn background_tasks(
    session: &ResolvedSession,
    cache: &BackgroundTaskCache,
) -> Result<Vec<BackgroundTask>, BindingsError> {
    if !session.provider.capabilities().has_background_tasks {
        return Ok(Vec::new());
    }
    // Stamped before reading, so a change during the read misses next time.
    let version = source_stamp(session)?.version;
    let key = session.locator.id.to_string();
    let lock = || {
        cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    };
    if let Some((cached, tasks)) = lock().get(&key)
        && *cached == version
    {
        return Ok(tasks.clone());
    }
    let tasks = session
        .provider
        .artifacts(&session.locator)?
        .background_tasks;
    lock().put(key, (version, tasks.clone()));
    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
    use tracepilot_core::provider::{
        Liveness, ProviderSnapshot, SessionArtifacts, SessionLocator, SessionProvider,
        SessionSource, SourceCapabilities, SourceFingerprint,
    };

    /// Claude Code, counting how often background tasks are read.
    struct CountingReads {
        inner: ClaudeCodeProvider,
        reads: AtomicUsize,
    }

    impl SessionProvider for CountingReads {
        fn source(&self) -> SessionSource {
            self.inner.source()
        }
        fn capabilities(&self) -> SourceCapabilities {
            self.inner.capabilities()
        }
        fn discover(
            &self,
            is_cancelled: &dyn Fn() -> bool,
        ) -> tracepilot_core::Result<Vec<SessionLocator>> {
            self.inner.discover(is_cancelled)
        }
        fn fingerprint(
            &self,
            session: &SessionLocator,
        ) -> tracepilot_core::Result<SourceFingerprint> {
            self.inner.fingerprint(session)
        }
        fn load_snapshot(
            &self,
            session: &SessionLocator,
            strict: bool,
            is_cancelled: &dyn Fn() -> bool,
        ) -> tracepilot_core::Result<ProviderSnapshot> {
            self.inner.load_snapshot(session, strict, is_cancelled)
        }
        fn liveness(&self, session: &SessionLocator) -> Liveness {
            self.inner.liveness(session)
        }
        fn resolve(
            &self,
            id: &tracepilot_core::SessionId,
        ) -> tracepilot_core::Result<Option<SessionLocator>> {
            self.inner.resolve(id)
        }
        fn artifacts(&self, session: &SessionLocator) -> tracepilot_core::Result<SessionArtifacts> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.inner.artifacts(session)
        }
    }

    fn notification(task: &str) -> String {
        let content = format!(
            "<task-notification>
<task-id>{task}</task-id>
<status>completed</status>
             <summary>Background command \"{task}\" completed</summary>
</task-notification>"
        );
        let record = serde_json::json!({"type": "user", "uuid": task,
            "sessionId": "11111111-1111-4111-8111-111111111111",
            "timestamp": "2026-09-20T10:00:00Z", "origin": {"kind": "task-notification"},
            "message": {"role": "user", "content": content}});
        format!(
            "{record}
"
        )
    }

    fn ids(tasks: &[BackgroundTask]) -> Vec<&str> {
        tasks.iter().map(|task| task.id.as_str()).collect()
    }

    #[test]
    fn background_tasks_are_reread_only_when_the_source_changes() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("projects").join("demo");
        std::fs::create_dir_all(&project).unwrap();
        let main = project.join("11111111-1111-4111-8111-111111111111.jsonl");
        std::fs::write(&main, notification("shell1")).unwrap();
        let provider = Arc::new(CountingReads {
            inner: ClaudeCodeProvider::new(dir.path()),
            reads: AtomicUsize::new(0),
        });
        let locator = provider.discover(&|| false).unwrap().remove(0);
        let session = ResolvedSession {
            provider: provider.clone(),
            locator,
        };
        let cache: BackgroundTaskCache = Mutex::new(crate::cache::build_session_lru(2));

        let first = background_tasks(&session, &cache).unwrap();
        assert_eq!(ids(&first), ["shell1"]);
        assert_eq!(background_tasks(&session, &cache).unwrap(), first);
        assert_eq!(
            provider.reads.load(Ordering::SeqCst),
            1,
            "unchanged: reused"
        );

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&main)
            .unwrap();
        std::io::Write::write_all(&mut file, notification("shell2").as_bytes()).unwrap();
        drop(file);
        let after = background_tasks(&session, &cache).unwrap();
        assert_eq!(ids(&after), ["shell1", "shell2"]);
        assert_eq!(
            provider.reads.load(Ordering::SeqCst),
            2,
            "changed: read again"
        );
    }
}
