//! A source's artifacts (plan, file history, background tasks), reused while
//! the session's source version is unchanged.
//!
//! A running session's detail view asks for them on every refresh, and the
//! provider builds all of them from one read of every transcript, so one
//! read per source version serves every artifact command. Plan files and
//! file-history backups are still read when shown: only what the transcript
//! says about them is cached.

use std::sync::{Arc, LazyLock, Mutex};

use lru::LruCache;
use tracepilot_core::provider::{ResolvedSession, SessionArtifacts};

use super::shared::source_stamp;
use crate::error::BindingsError;

/// Artifacts per session with the source version they were read at.
type ArtifactCache = Mutex<LruCache<String, (String, Arc<SessionArtifacts>)>>;

/// Bounded by session count, not bytes: an entry is metadata (paths, plan
/// text, checkpoint file lists, task summaries), far smaller than the event
/// cache's entries.
static ARTIFACTS: LazyLock<ArtifactCache> = LazyLock::new(|| {
    Mutex::new(crate::cache::build_session_lru(
        crate::config::DEFAULT_SESSION_CACHE_SIZE,
    ))
});

/// The session's artifacts, read once per source version. Blocking.
pub(super) fn session_artifacts(
    session: &ResolvedSession,
) -> Result<Arc<SessionArtifacts>, BindingsError> {
    artifacts_in(session, &ARTIFACTS)
}

fn artifacts_in(
    session: &ResolvedSession,
    cache: &ArtifactCache,
) -> Result<Arc<SessionArtifacts>, BindingsError> {
    // Stamped before reading, so a change during the read misses next time.
    let version = source_stamp(session)?.version;
    let key = session.locator.id.to_string();
    let lock = || {
        cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    };
    if let Some((cached, artifacts)) = lock().get(&key)
        && *cached == version
    {
        return Ok(Arc::clone(artifacts));
    }
    let artifacts = Arc::new(session.provider.artifacts(&session.locator)?);
    lock().put(key, (version, Arc::clone(&artifacts)));
    Ok(artifacts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
    use tracepilot_core::provider::{
        BackgroundTask, Liveness, ProviderSnapshot, SessionLocator, SessionProvider, SessionSource,
        SourceCapabilities, SourceFingerprint,
    };

    /// Claude Code, counting how often its artifacts are read.
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

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    fn notification(task: &str) -> String {
        let content = format!(
            "<task-notification>\n<task-id>{task}</task-id>\n<status>completed</status>\n\
             <summary>Background command \"{task}\" completed</summary>\n</task-notification>"
        );
        let record = serde_json::json!({"type": "user", "uuid": task, "sessionId": ID,
            "timestamp": "2026-09-20T10:00:00Z", "origin": {"kind": "task-notification"},
            "message": {"role": "user", "content": content}});
        format!("{record}\n")
    }

    fn plan(text: &str) -> String {
        let record = serde_json::json!({"type": "assistant", "uuid": "plan", "sessionId": ID,
            "timestamp": "2026-09-20T10:00:01Z", "message": {"id": "m", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_plan", "name": "ExitPlanMode",
                    "input": {"plan": text}}]}});
        format!("{record}\n")
    }

    fn ids(tasks: &[BackgroundTask]) -> Vec<&str> {
        tasks.iter().map(|task| task.id.as_str()).collect()
    }

    #[test]
    fn artifacts_are_reread_only_when_the_source_changes() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("projects").join("demo");
        std::fs::create_dir_all(&project).unwrap();
        let main = project.join(format!("{ID}.jsonl"));
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
        let cache: ArtifactCache = Mutex::new(crate::cache::build_session_lru(2));

        let first = artifacts_in(&session, &cache).unwrap();
        assert_eq!(ids(&first.background_tasks), ["shell1"]);
        assert!(first.plan.is_none());
        let again = artifacts_in(&session, &cache).unwrap();
        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(
            provider.reads.load(Ordering::SeqCst),
            1,
            "unchanged: reused"
        );

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&main)
            .unwrap();
        let appended = notification("shell2") + &plan("Ship it.");
        std::io::Write::write_all(&mut file, appended.as_bytes()).unwrap();
        drop(file);
        let after = artifacts_in(&session, &cache).unwrap();
        assert_eq!(ids(&after.background_tasks), ["shell1", "shell2"]);
        assert_eq!(
            after.plan.as_ref().unwrap().read().unwrap().as_deref(),
            Some("Ship it.")
        );
        assert_eq!(
            provider.reads.load(Ordering::SeqCst),
            2,
            "changed: read again"
        );
    }
}
