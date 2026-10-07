//! The Copilot CLI provider: a thin wrapper over the existing loaders.
//!
//! Behaviour is identical to calling those loaders directly; the parity
//! tests in `tests.rs` and the golden snapshots guard that.

use std::path::{Path, PathBuf};

use crate::error::{Result, TracePilotError};
use crate::ids::SessionId;
use crate::models::session_summary::SessionSummary;
use crate::parsing::checkpoints::parse_checkpoints;
use crate::parsing::events::{TypedEvent, load_event_snapshot, parse_typed_events_if_exists};
use crate::parsing::rewind_snapshots::parse_rewind_index;
use crate::parsing::session_db::{read_todo_deps, read_todos};
use crate::parsing::snapshot::{FileFingerprint, check_cancelled};
use crate::paths::SessionPaths;
use crate::session::discovery::{
    discover_sessions_cancellable, has_lock_file, resolve_session_path_direct,
};
use crate::summary::{
    SessionFingerprint, SessionLoadResult, load_session_snapshot, load_session_summary_from_events,
    load_session_summary_with_events,
};

use super::{
    Liveness, ProviderEvents, ProviderSnapshot, SessionArtifacts, SessionLocator, SessionProvider,
    SessionRole, SessionSource, SourceCapabilities, SourceFingerprint, TodoList,
};

const CAPABILITIES: SourceCapabilities = SourceCapabilities {
    can_resume: true,
    can_launch: true,
    can_steer: true,
    has_aic: true,
    has_premium_requests: true,
    has_context_breakdown: true,
    has_todos: true,
    has_checkpoints: true,
    has_plan: true,
    has_explorer: true,
    has_hidden_roles: false,
};

/// Sessions under one Copilot `session-state` directory.
pub struct CopilotProvider {
    session_state_dir: PathBuf,
}

impl CopilotProvider {
    pub fn new(session_state_dir: impl Into<PathBuf>) -> Self {
        Self {
            session_state_dir: session_state_dir.into(),
        }
    }

    pub fn session_state_dir(&self) -> &Path {
        &self.session_state_dir
    }

    /// The locator of the session directory `dir`, named by its directory.
    pub fn session_at(dir: impl Into<PathBuf>) -> SessionLocator {
        let dir = dir.into();
        let name = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        Self::locator(SessionId::from_validated(name.unwrap_or_default()), dir)
    }

    fn locator(id: SessionId, dir: PathBuf) -> SessionLocator {
        let source_bytes_hint = std::fs::metadata(SessionPaths::from_root(&dir).events_jsonl())
            .map_or(0, |metadata| metadata.len());
        SessionLocator {
            source: SessionSource::Copilot,
            id,
            primary_path: dir,
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint,
        }
    }
}

/// `SessionFingerprint` as a two-entry [`SourceFingerprint`].
pub fn source_fingerprint(
    session_dir: &Path,
    fingerprint: SessionFingerprint,
) -> SourceFingerprint {
    let paths = SessionPaths::from_root(session_dir);
    SourceFingerprint::new(
        vec![
            (paths.workspace_yaml(), fingerprint.workspace),
            (paths.events_jsonl(), fingerprint.events),
        ],
        None,
    )
}

/// The inverse of [`source_fingerprint`]: the stored Copilot form.
fn session_fingerprint(fingerprint: &SourceFingerprint) -> SessionFingerprint {
    let entry = |name: &str| {
        fingerprint
            .files
            .iter()
            .find(|(path, _)| path.file_name().is_some_and(|file| file == name))
            .and_then(|(_, file)| file.clone())
    };
    SessionFingerprint {
        workspace: entry("workspace.yaml"),
        events: entry("events.jsonl"),
    }
}

fn snapshot(load: SessionLoadResult, fingerprint: SourceFingerprint) -> ProviderSnapshot {
    ProviderSnapshot {
        summary: load.summary,
        events: load.typed_events,
        turns: load.turns,
        metrics: None,
        diagnostics: load.diagnostics,
        fingerprint,
    }
}

impl SessionProvider for CopilotProvider {
    fn source(&self) -> SessionSource {
        SessionSource::Copilot
    }

    fn capabilities(&self) -> SourceCapabilities {
        CAPABILITIES
    }

    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> Result<Vec<SessionLocator>> {
        Ok(
            discover_sessions_cancellable(&self.session_state_dir, &is_cancelled)?
                .into_iter()
                .map(|session| Self::locator(session.id, session.path))
                .collect(),
        )
    }

    fn fingerprint(&self, session: &SessionLocator) -> Result<SourceFingerprint> {
        let dir = &session.primary_path;
        Ok(source_fingerprint(dir, SessionFingerprint::read(dir)?))
    }

    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ProviderSnapshot> {
        let dir = &session.primary_path;
        if strict {
            let (load, fingerprint) = load_session_snapshot(dir, &is_cancelled)?;
            return Ok(snapshot(load, source_fingerprint(dir, fingerprint)));
        }
        check_cancelled(&is_cancelled)?;
        let fingerprint = self.fingerprint(session)?;
        Ok(snapshot(
            load_session_summary_with_events(dir)?,
            fingerprint,
        ))
    }

    /// Events only: search needs neither `workspace.yaml` nor turns.
    fn load_events_strict(
        &self,
        session: &SessionLocator,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ProviderEvents> {
        let paths = SessionPaths::from_root(&session.primary_path);
        let workspace = FileFingerprint::read(&paths.workspace_yaml())?;
        let snapshot = load_event_snapshot(&paths.events_jsonl(), &is_cancelled)?;
        let fingerprint = SessionFingerprint {
            workspace,
            events: snapshot.fingerprint,
        };
        Ok(ProviderEvents {
            events: snapshot.parsed.map(|parsed| parsed.events),
            fingerprint: source_fingerprint(&session.primary_path, fingerprint),
        })
    }

    /// An absent `session-state` directory has no sessions to list, but it
    /// is not a complete inventory either.
    fn root_exists(&self) -> bool {
        self.session_state_dir.is_dir()
    }

    /// Kept in the `SessionFingerprint` form existing indexes store.
    fn stored_fingerprint(&self, fingerprint: &SourceFingerprint) -> Result<String> {
        Ok(serde_json::to_string(&session_fingerprint(fingerprint))?)
    }

    /// Search content comes from `events.jsonl` alone.
    fn stored_search_fingerprint(&self, fingerprint: &SourceFingerprint) -> Result<String> {
        Ok(serde_json::to_string(
            &session_fingerprint(fingerprint).events,
        )?)
    }

    fn liveness(&self, session: &SessionLocator) -> Liveness {
        if has_lock_file(&session.primary_path) {
            Liveness::Running {
                pid: None,
                status: None,
            }
        } else {
            Liveness::Idle
        }
    }

    fn artifacts(&self, session: &SessionLocator) -> Result<SessionArtifacts> {
        let dir = &session.primary_path;
        let paths = SessionPaths::from_root(dir);
        let db = paths.session_db();
        let todos = if db.exists() {
            Some(TodoList {
                items: read_todos(&db)?,
                deps: Some(read_todo_deps(&db)?),
            })
        } else {
            None
        };
        let plan = paths.plan_md();
        Ok(SessionArtifacts {
            todos,
            plan: plan.exists().then_some(plan),
            checkpoints: parse_checkpoints(dir)?,
            rewind: parse_rewind_index(dir)?,
            file_roots: vec![dir.clone()],
        })
    }

    fn root(&self) -> Option<&Path> {
        Some(&self.session_state_dir)
    }

    /// Only `<session-state>/<id>` itself, exactly as [`Self::resolve`]
    /// builds it.
    fn owns(&self, session: &SessionLocator) -> bool {
        session.source == SessionSource::Copilot
            && session.primary_path == self.session_state_dir.join(session.id.as_str())
    }

    fn file_roots(&self, session: &SessionLocator) -> Result<Vec<PathBuf>> {
        Ok(vec![session.primary_path.clone()])
    }

    fn load_events(
        &self,
        session: &SessionLocator,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<Option<Vec<TypedEvent>>> {
        check_cancelled(&is_cancelled)?;
        let events = SessionPaths::from_root(&session.primary_path).events_jsonl();
        Ok(parse_typed_events_if_exists(&events)?.map(|parsed| parsed.events))
    }

    fn summary_from_events(
        &self,
        session: &SessionLocator,
        events: &[TypedEvent],
    ) -> Result<SessionSummary> {
        load_session_summary_from_events(&session.primary_path, events)
    }

    fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>> {
        match resolve_session_path_direct(id.as_str(), &self.session_state_dir) {
            Ok(dir) => Ok(Some(Self::locator(id.clone(), dir))),
            Err(TracePilotError::SessionNotFound(_)) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests;
