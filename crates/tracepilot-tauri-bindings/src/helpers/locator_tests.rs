//! Session resolution: index-first, provider fallback, and refusals.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{
    CopilotProvider, Liveness, ProviderSnapshot, ResolvedSession, SessionLocator, SessionProvider,
    SessionRole, SessionSource, SourceCapabilities, SourceFingerprint,
};
use tracepilot_indexer::index_db::IndexDb;

use super::locator::stored_locator;
use super::*;
use crate::config::{PathsConfig, SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};

const ID: &str = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

struct Fixture {
    temp: tempfile::TempDir,
    config: TracePilotConfig,
}

impl Fixture {
    /// A Copilot root under `sessions/` and TracePilot data under `home/`.
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let config = TracePilotConfig {
            paths: PathsConfig {
                copilot_home: String::new(),
                tracepilot_home: temp.path().join("home").to_string_lossy().into(),
                session_state_dir: temp.path().join("sessions").to_string_lossy().into(),
                index_db_path: String::new(),
            },
            ..Default::default()
        };
        std::fs::create_dir_all(temp.path().join("home")).unwrap();
        Self { temp, config }
    }

    fn state(&self) -> SharedConfig {
        Arc::new(RwLock::new(Some(self.config.clone())))
    }

    fn sessions(&self) -> PathBuf {
        self.config.session_state_dir()
    }

    fn write_session(&self, root: &Path) -> PathBuf {
        let dir = root.join(ID);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("workspace.yaml"), format!("id: {ID}\n")).unwrap();
        std::fs::write(
            dir.join("events.jsonl"),
            r#"{"type":"user.message","data":{"content":"hi","interactionId":"i1"},"id":"e1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#,
        )
        .unwrap();
        dir
    }

    /// Index the session at `dir`, then rewrite its row's source and path.
    fn index_row(&self, dir: &Path, source: &str, path: &Path) {
        let db = IndexDb::open_or_create(&self.config.index_db_path()).unwrap();
        let id = SessionId::from_validated(ID);
        if db.get_session_locator(&id).unwrap().is_none() {
            db.upsert_session(dir).unwrap();
        }
        drop(db);
        let conn = rusqlite::Connection::open(self.config.index_db_path()).unwrap();
        conn.execute(
            "UPDATE sessions SET source = ?1, path = ?2 WHERE id = ?3",
            [source, &path.to_string_lossy(), ID],
        )
        .unwrap();
    }

    fn resolve(&self) -> CmdResult<ResolvedSession> {
        resolve_session(&self.config, &SessionId::from_validated(ID))
    }
}

#[tokio::test]
async fn missing_session_names_the_id() {
    let fixture = Fixture::new();
    let result = with_session_locator(
        &fixture.state(),
        SessionId::from_validated(ID),
        |_session| Ok("should not reach here".to_string()),
    )
    .await;
    let message = result.unwrap_err().to_string();
    assert!(
        message.contains(ID),
        "error should name the session: {message}"
    );
}

#[tokio::test]
async fn runs_the_closure_on_the_resolved_copilot_session() {
    let fixture = Fixture::new();
    let dir = fixture.write_session(&fixture.sessions());
    let session = with_session_locator(&fixture.state(), SessionId::from_validated(ID), Ok)
        .await
        .unwrap();
    assert_eq!(session.locator.source, SessionSource::Copilot);
    assert_eq!(session.locator.primary_path, dir);
    assert_eq!(session.provider.source(), SessionSource::Copilot);
}

#[tokio::test]
async fn closure_errors_propagate() {
    let fixture = Fixture::new();
    fixture.write_session(&fixture.sessions());
    let result: CmdResult<()> =
        with_session_locator(&fixture.state(), SessionId::from_validated(ID), |_| {
            Err(BindingsError::Validation("deliberate test error".into()))
        })
        .await;
    assert_eq!(result.unwrap_err().to_string(), "deliberate test error");
}

#[test]
fn the_index_row_is_used_when_it_names_the_current_root() {
    let fixture = Fixture::new();
    let dir = fixture.write_session(&fixture.sessions());
    fixture.index_row(&dir, "copilot", &dir);
    let stored = stored_locator(
        &fixture.config.index_db_path(),
        &SessionId::from_validated(ID),
    )
    .unwrap();
    assert_eq!(stored.primary_path, dir);
    assert_eq!(fixture.resolve().unwrap().locator, stored);
}

#[test]
fn rows_from_another_root_or_source_never_redirect_a_command() {
    let fixture = Fixture::new();
    let current = fixture.write_session(&fixture.sessions());
    let old_root = fixture.temp.path().join("old-sessions");
    let stale = fixture.write_session(&old_root);
    let traversal = fixture.sessions().join("..").join("old-sessions").join(ID);
    for (source, path) in [
        ("copilot", &stale),
        ("copilot", &traversal),
        ("claudeCode", &stale),
        ("claudeCode", &current),
    ] {
        fixture.index_row(&stale, source, path);
        let session = fixture.resolve().unwrap();
        assert_eq!(session.locator.source, SessionSource::Copilot, "{source}");
        assert_eq!(session.locator.primary_path, current, "{source} {path:?}");
    }

    // With nothing under the current root, a stale row is not found.
    std::fs::remove_dir_all(&current).unwrap();
    fixture.index_row(&stale, "copilot", &stale);
    let error = fixture.resolve().err().unwrap();
    assert!(matches!(
        error,
        BindingsError::Core(tracepilot_core::TracePilotError::SessionNotFound(_))
    ));
}

#[test]
fn an_unreadable_index_falls_back_to_the_providers() {
    let fixture = Fixture::new();
    let dir = fixture.write_session(&fixture.sessions());
    std::fs::write(fixture.config.index_db_path(), "not a database").unwrap();
    assert_eq!(fixture.resolve().unwrap().locator.primary_path, dir);
}

fn claude_session(root: &Path) -> ResolvedSession {
    ResolvedSession {
        provider: Arc::new(ClaudeCodeProvider::new(root)),
        locator: SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(ID),
            primary_path: root.join("projects").join("p").join(format!("{ID}.jsonl")),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        },
    }
}

#[test]
fn copilot_only_actions_are_refused_with_a_typed_error() {
    let fixture = Fixture::new();
    fixture.write_session(&fixture.sessions());
    let copilot = fixture.resolve().unwrap();
    require_capability(&copilot, |caps| caps.can_resume, "Resume").unwrap();
    require_copilot_layout(&copilot, "Export").unwrap();
    assert_eq!(
        explorer_roots(&copilot).unwrap(),
        vec![copilot.locator.primary_path.clone()]
    );

    let claude = claude_session(fixture.temp.path());
    // Both sources resume in a terminal; only Copilot is driven by TracePilot.
    for session in [&copilot, &claude] {
        require_capability(session, |caps| caps.can_resume_in_terminal, "Resume").unwrap();
    }
    // Claude Code browses the session's subagent and tool-result folders.
    let session_dir = claude.locator.primary_path.with_extension("");
    assert_eq!(
        explorer_roots(&claude).unwrap(),
        vec![
            session_dir.join("subagents"),
            session_dir.join("tool-results")
        ]
    );
    for error in [
        require_capability(&claude, |caps| caps.can_resume, "Resume").unwrap_err(),
        require_copilot_layout(&claude, "Export").unwrap_err(),
    ] {
        assert!(
            matches!(
                error,
                BindingsError::Unsupported {
                    session_source: SessionSource::ClaudeCode,
                    ..
                }
            ),
            "{error:?}"
        );
        assert_eq!(error.code(), crate::error::ErrorCode::Unsupported);
    }
}

/// A browsable source whose file roots come from the test.
struct BrowsableProvider {
    inner: CopilotProvider,
    roots: Vec<PathBuf>,
}

impl SessionProvider for BrowsableProvider {
    fn source(&self) -> SessionSource {
        SessionSource::ClaudeCode
    }
    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities {
            has_explorer: true,
            ..SourceCapabilities::default()
        }
    }
    fn discover(&self, c: &dyn Fn() -> bool) -> tracepilot_core::Result<Vec<SessionLocator>> {
        self.inner.discover(c)
    }
    fn fingerprint(&self, s: &SessionLocator) -> tracepilot_core::Result<SourceFingerprint> {
        self.inner.fingerprint(s)
    }
    fn load_snapshot(
        &self,
        s: &SessionLocator,
        strict: bool,
        c: &dyn Fn() -> bool,
    ) -> tracepilot_core::Result<ProviderSnapshot> {
        self.inner.load_snapshot(s, strict, c)
    }
    fn liveness(&self, s: &SessionLocator) -> Liveness {
        self.inner.liveness(s)
    }
    fn root(&self) -> Option<&Path> {
        self.inner.root()
    }
    fn file_roots(&self, _s: &SessionLocator) -> tracepilot_core::Result<Vec<PathBuf>> {
        Ok(self.roots.clone())
    }
    fn resolve(&self, id: &SessionId) -> tracepilot_core::Result<Option<SessionLocator>> {
        self.inner.resolve(id)
    }
}

#[test]
fn file_roots_outside_the_source_root_are_refused() {
    let fixture = Fixture::new();
    let dir = fixture.write_session(&fixture.sessions());
    let browse = |roots: Vec<PathBuf>| {
        let session = ResolvedSession {
            provider: Arc::new(BrowsableProvider {
                inner: CopilotProvider::new(fixture.sessions()),
                roots,
            }),
            locator: fixture.resolve().unwrap().locator,
        };
        explorer_roots(&session)
    };
    assert_eq!(browse(vec![dir.clone()]).unwrap(), vec![dir.clone()]);
    // One root outside refuses them all.
    assert!(matches!(
        browse(vec![dir.join("a"), fixture.temp.path().join("home")]),
        Err(BindingsError::Validation(_))
    ));
    for outside in [
        fixture.temp.path().join("home"),
        fixture.sessions(),
        fixture.sessions().join("..").join("home"),
    ] {
        assert!(
            matches!(
                browse(vec![outside.clone()]),
                Err(BindingsError::Validation(_))
            ),
            "{outside:?}"
        );
    }
    assert!(matches!(
        browse(Vec::new()),
        Err(BindingsError::Unsupported { .. })
    ));
}
