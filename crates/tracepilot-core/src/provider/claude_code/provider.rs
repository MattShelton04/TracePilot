//! [`ClaudeCodeProvider`]: the sessions under one Claude Code config
//! directory (`CLAUDE_CONFIG_DIR`, by default `~/.claude`).
//!
//! A session is `projects/<cwd-slug>/<uuid>.jsonl` plus the files in
//! `<uuid>/subagents/`. Other files a transcript references (`tool-results/`,
//! file history) are never read. Nothing registers this provider until the
//! experimental flag (F8) does.

use std::path::{Component, Path, PathBuf};

use super::liveness::{ProcessStart, liveness, liveness_many};
use super::parse_claude_session;
use super::summary::summarize;
use crate::error::{Result, TracePilotError};
use crate::ids::SessionId;
use crate::parsing::snapshot::{FileFingerprint, check_cancelled, ensure_unchanged};
use crate::provider::{
    Liveness, ProviderSnapshot, SessionLocator, SessionProvider, SessionRole, SessionSource,
    SourceCapabilities, SourceFingerprint,
};

/// Nothing Copilot-specific, and no todos, plan, checkpoints or explorer
/// roots yet (C12, C13).
const CAPABILITIES: SourceCapabilities = SourceCapabilities {
    can_resume: false,
    can_launch: false,
    can_steer: false,
    has_aic: false,
    has_premium_requests: false,
    has_context_breakdown: false,
    has_todos: false,
    has_checkpoints: false,
    has_plan: false,
    has_explorer: false,
    has_hidden_roles: false,
};

/// Sessions under one Claude Code config directory.
pub struct ClaudeCodeProvider {
    config_dir: PathBuf,
    /// `<config_dir>/projects`, the root every transcript lives under.
    projects_dir: PathBuf,
    process_start: Option<ProcessStart>,
}

impl ClaudeCodeProvider {
    pub fn new(config_dir: impl Into<PathBuf>) -> Self {
        let config_dir = config_dir.into();
        Self {
            projects_dir: config_dir.join("projects"),
            config_dir,
            process_start: None,
        }
    }

    /// Verify `sessions/<pid>.json` against live processes. Without this,
    /// [`SessionProvider::liveness`] reports `Unknown` for a session that has
    /// a pid file, because the file alone may be stale.
    pub fn with_process_start(mut self, process_start: ProcessStart) -> Self {
        self.process_start = Some(process_start);
        self
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    fn locator(id: SessionId, main: PathBuf) -> Result<SessionLocator> {
        let source_bytes_hint = session_files(&main)?
            .iter()
            .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
            .filter_map(|path| std::fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .sum();
        Ok(SessionLocator {
            source: SessionSource::ClaudeCode,
            id,
            primary_path: main,
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint,
        })
    }
}

/// The main transcript and every subagent transcript and `meta.json`: the
/// files a load reads.
fn session_files(main: &Path) -> Result<Vec<PathBuf>> {
    let mut files = vec![main.to_path_buf()];
    let dir = main.with_extension("").join("subagents");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(error) => {
            return Err(TracePilotError::io_context(
                "Failed to read",
                dir.display(),
                error,
            ));
        }
    };
    for entry in entries {
        let path = entry?.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with("agent-") && (name.ends_with(".jsonl") || name.ends_with(".meta.json"))
        {
            files.push(path);
        }
    }
    Ok(files)
}

/// `<uuid>.jsonl` → the session id.
fn session_id(path: &Path) -> Option<SessionId> {
    if path.extension().is_none_or(|ext| ext != "jsonl") {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let id = uuid::Uuid::parse_str(stem).ok()?;
    Some(SessionId::from_validated(id.to_string()))
}

impl SessionProvider for ClaudeCodeProvider {
    fn source(&self) -> SessionSource {
        SessionSource::ClaudeCode
    }

    fn capabilities(&self) -> SourceCapabilities {
        CAPABILITIES
    }

    /// A missing config directory is an error, so a caller never prunes
    /// against the empty inventory of an unmounted or moved root. A config
    /// directory without `projects/` has no sessions yet.
    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> Result<Vec<SessionLocator>> {
        check_cancelled(&is_cancelled)?;
        if !self.config_dir.is_dir() {
            return Err(TracePilotError::io_context(
                "Claude Code config directory not found:",
                self.config_dir.display(),
                std::io::Error::from(std::io::ErrorKind::NotFound),
            ));
        }
        let projects_dir = &self.projects_dir;
        let projects = match std::fs::read_dir(projects_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(TracePilotError::io_context(
                    "Failed to read",
                    projects_dir.display(),
                    error,
                ));
            }
        };
        let mut sessions = Vec::new();
        for project in projects {
            check_cancelled(&is_cancelled)?;
            let project = project?.path();
            if !project.is_dir() {
                continue;
            }
            let files = std::fs::read_dir(&project)
                .map_err(|e| TracePilotError::io_context("Failed to read", project.display(), e))?;
            for file in files {
                check_cancelled(&is_cancelled)?;
                let path = file?.path();
                if let Some(id) = session_id(&path).filter(|_| path.is_file()) {
                    sessions.push(Self::locator(id, path)?);
                }
            }
        }
        check_cancelled(&is_cancelled)?;
        sessions.sort_by(|a, b| a.primary_path.cmp(&b.primary_path));
        Ok(sessions)
    }

    fn fingerprint(&self, session: &SessionLocator) -> Result<SourceFingerprint> {
        let files = session_files(&session.primary_path)?
            .into_iter()
            .map(|path| FileFingerprint::read(&path).map(|fingerprint| (path, fingerprint)))
            .collect::<Result<_>>()?;
        Ok(SourceFingerprint::new(files, None))
    }

    /// Strict loads fail when any record was skipped (malformed, oversized,
    /// or a partial last line of a live file mid-append), like Copilot's, so
    /// a skipped record never reaches a durable index. Best-effort loads
    /// keep the rest and report the skipped lines in their diagnostics.
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ProviderSnapshot> {
        check_cancelled(&is_cancelled)?;
        let main = &session.primary_path;
        let fingerprint = self.fingerprint(session)?;
        let parsed = parse_claude_session(main, &is_cancelled)?;
        let diagnostics = &parsed.diagnostics;
        if strict
            && (diagnostics.malformed_lines > 0
                || diagnostics.oversized_lines > 0
                || diagnostics.partial_tails > 0
                || !diagnostics.events.deserialization_failures.is_empty())
        {
            return Err(TracePilotError::ParseError {
                context: format!("Incomplete Claude Code snapshot: {}", main.display()),
                source: None,
            });
        }
        let (summary, turns, metrics) = summarize(&session.id, &parsed);
        check_cancelled(&is_cancelled)?;
        if strict {
            ensure_unchanged(&fingerprint, &self.fingerprint(session)?, main)?;
        }
        Ok(ProviderSnapshot {
            summary,
            events: Some(parsed.events),
            turns: Some(turns),
            metrics,
            diagnostics: Some(parsed.diagnostics.events),
            fingerprint,
        })
    }

    fn liveness(&self, session: &SessionLocator) -> Liveness {
        liveness(
            &self.config_dir.join("sessions"),
            session.id.as_str(),
            self.process_start.as_ref(),
        )
    }

    fn liveness_many(&self, sessions: &[SessionLocator]) -> Vec<Liveness> {
        liveness_many(
            &self.config_dir.join("sessions"),
            sessions.iter().map(|session| session.id.as_str()),
            self.process_start.as_ref(),
        )
    }

    fn root(&self) -> Option<&Path> {
        Some(&self.projects_dir)
    }

    /// Only a main transcript exactly where [`Self::resolve`] looks:
    /// `<projects>/<one project dir>/<id>.jsonl`, and a regular file.
    fn owns(&self, session: &SessionLocator) -> bool {
        let Ok(relative) = session.primary_path.strip_prefix(&self.projects_dir) else {
            return false;
        };
        let mut components = relative.components();
        let expected = format!("{}.jsonl", session.id.as_str());
        session.source == SessionSource::ClaudeCode
            && matches!(components.next(), Some(Component::Normal(_)))
            && matches!(components.next(), Some(Component::Normal(name)) if name == expected.as_str())
            && components.next().is_none()
            && session.primary_path.is_file()
    }

    fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>> {
        // Only a UUID can name a transcript; never join anything else to a path.
        if uuid::Uuid::parse_str(id.as_str()).is_err() {
            return Ok(None);
        }
        let projects = match std::fs::read_dir(&self.projects_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        for project in projects {
            let main = project?.path().join(format!("{}.jsonl", id.as_str()));
            if main.is_file()
                && let Some(id) = session_id(&main)
            {
                return Self::locator(id, main).map(Some);
            }
        }
        Ok(None)
    }
}
