//! The Copilot CLI provider: a thin wrapper over the existing loaders.
//!
//! Behaviour is identical to calling those loaders directly; the parity
//! tests in `tests.rs` and the golden snapshots guard that.

use std::path::{Path, PathBuf};

use crate::error::{Result, TracePilotError};
use crate::ids::SessionId;
use crate::parsing::checkpoints::parse_checkpoints;
use crate::parsing::rewind_snapshots::parse_rewind_index;
use crate::parsing::session_db::{read_todo_deps, read_todos};
use crate::parsing::snapshot::check_cancelled;
use crate::paths::SessionPaths;
use crate::session::discovery::{
    discover_sessions_cancellable, has_lock_file, resolve_session_path_direct,
};
use crate::summary::{
    SessionFingerprint, SessionLoadResult, load_session_snapshot, load_session_summary_with_events,
};

use super::{
    Liveness, ProviderSnapshot, SessionArtifacts, SessionLocator, SessionProvider, SessionRole,
    SessionSource, SourceCapabilities, SourceFingerprint, TodoList,
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
