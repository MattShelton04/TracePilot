//! Session sources behind one seam.
//!
//! Everything source-specific lives under this module. Consumers outside it
//! work on [`SessionLocator`]s, [`SourceFingerprint`]s and normalized
//! [`TypedEvent`](crate::parsing::events::TypedEvent)s, never on a source's
//! file layout.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use crate::error::Result;
use crate::ids::SessionId;
use crate::models::session_summary::SessionSummary;
use crate::parsing::events::{RawEvent, TypedEvent};

mod artifacts;
pub mod claude_code;
pub mod copilot;
mod types;

pub use artifacts::{
    FileCheckpoint, FileHistory, FileVersion, FileVersionContent, PlanArtifact, is_safe_backup_name,
};
pub use copilot::CopilotProvider;
pub use types::{
    BackgroundTask, BackgroundTaskKind, BackgroundTaskStatus, CostBasis, CostFigure, CostUnit,
    FormatObservations, Liveness, MetricsCoverage, MetricsSegment, NativeRecord, ProviderEvents,
    ProviderSnapshot, ResumeLaunch, RunStatus, SessionArtifacts, SessionLocator, SessionMetrics,
    SessionRole, SessionSource, SourceCapabilities, SourceFingerprint, TodoList,
};

/// Redact the fields of an event's source record that never leave the
/// machine in an export (data-comparison.md §5): identities, account ids,
/// system prompts and other model-facing text. An event whose payload is the
/// record itself (an unmapped record kept for the Events tab) is redacted
/// too. Copilot events carry no source record and are unchanged.
pub fn redact_native_record(event: &mut RawEvent) {
    let Some(native) = event.native.as_mut() else {
        return;
    };
    match native.source {
        SessionSource::Copilot => {}
        SessionSource::ClaudeCode => {
            claude_code::redact_record(&native.record_type, &mut native.data);
            if event.event_type == native.record_type {
                claude_code::redact_record(&native.record_type, &mut event.data);
            }
        }
    }
}

/// One session source: how to find its sessions and load them as
/// normalized events.
pub trait SessionProvider: Send + Sync {
    fn source(&self) -> SessionSource;

    fn capabilities(&self) -> SourceCapabilities;

    /// Every session under the source's root. A cancelled scan is an error,
    /// never a partial inventory that a caller might prune against.
    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> Result<Vec<SessionLocator>>;

    /// The current identity of every file a load would read.
    fn fingerprint(&self, session: &SessionLocator) -> Result<SourceFingerprint>;

    /// Load a session. `strict` loads are for durable indexes: they fail on
    /// incomplete sources and on files that change while reading. Other
    /// loads are best effort, for display.
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ProviderSnapshot>;

    /// A strict load of the events alone, for durable consumers that need
    /// no summary (search). Sources whose summary costs more than their
    /// events override it.
    fn load_events_strict(
        &self,
        session: &SessionLocator,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ProviderEvents> {
        let snapshot = self.load_snapshot(session, true, is_cancelled)?;
        Ok(ProviderEvents {
            events: snapshot.events,
            fingerprint: snapshot.fingerprint,
        })
    }

    /// Whether the configured root exists. A source that reports a missing
    /// root as an empty inventory must say so here, so that no caller prunes
    /// against it.
    fn root_exists(&self) -> bool {
        true
    }

    /// The stored form of a fingerprint (`sessions.source_fingerprint`),
    /// compared only for equality.
    fn stored_fingerprint(&self, fingerprint: &SourceFingerprint) -> Result<String> {
        Ok(serde_json::to_string(fingerprint)?)
    }

    /// The stored form of the files search content is extracted from
    /// (`sessions.search_source_fingerprint`).
    fn stored_search_fingerprint(&self, fingerprint: &SourceFingerprint) -> Result<String> {
        self.stored_fingerprint(fingerprint)
    }

    fn liveness(&self, session: &SessionLocator) -> Liveness;

    /// [`Self::liveness`] for each session, in order, for lists. Sources
    /// that can answer many sessions with less work than one call each (for
    /// example, one directory read) override it.
    fn liveness_many(&self, sessions: &[SessionLocator]) -> Vec<Liveness> {
        sessions
            .iter()
            .map(|session| self.liveness(session))
            .collect()
    }

    /// Todos, plan, checkpoints, browsable roots and background tasks.
    fn artifacts(&self, _session: &SessionLocator) -> Result<SessionArtifacts> {
        Ok(SessionArtifacts::default())
    }

    /// The directory every session of this source lives under. `None`
    /// means stored locators are never trusted and every lookup resolves
    /// afresh through [`Self::resolve`].
    fn root(&self) -> Option<&Path> {
        None
    }

    /// Whether a locator read from the index still names one of this
    /// source's sessions under its current root. A stale root, a foreign
    /// path or a path naming another session is never trusted.
    fn owns(&self, session: &SessionLocator) -> bool {
        session.source == self.source()
            && self
                .root()
                .is_some_and(|root| names_session_under(root, &session.primary_path, &session.id))
    }

    /// Directories the file browser and image preview may read.
    fn file_roots(&self, session: &SessionLocator) -> Result<Vec<PathBuf>> {
        Ok(self.artifacts(session)?.file_roots)
    }

    /// The session's latest plan.
    fn plan(&self, session: &SessionLocator) -> Result<Option<PlanArtifact>> {
        Ok(self.artifacts(session)?.plan)
    }

    /// The session's file backups, as rewind points.
    fn file_history(&self, session: &SessionLocator) -> Result<Option<FileHistory>> {
        Ok(self.artifacts(session)?.file_history)
    }

    /// Only the normalized events, for display. `None` when the source has
    /// no event log yet.
    fn load_events(
        &self,
        session: &SessionLocator,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<Option<Vec<TypedEvent>>> {
        Ok(self.load_snapshot(session, false, is_cancelled)?.events)
    }

    /// The display summary, built from events the caller already holds
    /// (for example, cached ones). The default reloads the session.
    fn summary_from_events(
        &self,
        session: &SessionLocator,
        _events: &[TypedEvent],
    ) -> Result<SessionSummary> {
        Ok(self.load_snapshot(session, false, &|| false)?.summary)
    }

    /// How to resume the session in a terminal, or `None` when it cannot be
    /// (for example, a subagent). `live_attach` asks for a terminal TracePilot
    /// can attach to, where the source supports that. Only sources with
    /// [`SourceCapabilities::can_resume_in_terminal`] override it.
    fn resume_launch(
        &self,
        _session: &SessionLocator,
        _live_attach: bool,
    ) -> Result<Option<ResumeLaunch>> {
        Ok(None)
    }

    /// Find a session by id without the index. `None` when the source has no
    /// such session.
    fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>>;
}

/// `path` lies strictly under `root` through plain names only, and its last
/// component (minus any extension) is the session id.
fn names_session_under(root: &Path, path: &Path, id: &SessionId) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    relative.components().next().is_some()
        && relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && path
            .file_stem()
            .is_some_and(|stem| stem == std::ffi::OsStr::new(id.as_str()))
}

/// A session id resolved to the provider that owns it.
#[derive(Clone)]
pub struct ResolvedSession {
    pub provider: Arc<dyn SessionProvider>,
    pub locator: SessionLocator,
}

/// The outcome of one source's discovery pass.
pub struct SourceInventory {
    pub source: SessionSource,
    pub sessions: Result<Vec<SessionLocator>>,
}

/// The enabled providers, at most one per source.
#[derive(Clone, Default)]
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn SessionProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a provider, replacing and returning any provider for the same source.
    pub fn register(
        &mut self,
        provider: Arc<dyn SessionProvider>,
    ) -> Option<Arc<dyn SessionProvider>> {
        let source = provider.source();
        match self.providers.iter_mut().find(|p| p.source() == source) {
            Some(existing) => Some(std::mem::replace(existing, provider)),
            None => {
                self.providers.push(provider);
                None
            }
        }
    }

    pub fn get(&self, source: SessionSource) -> Option<&Arc<dyn SessionProvider>> {
        self.providers.iter().find(|p| p.source() == source)
    }

    pub fn providers(&self) -> &[Arc<dyn SessionProvider>] {
        &self.providers
    }

    /// Discover every source independently, so one failed or cancelled
    /// source never hides another's complete inventory.
    pub fn discover_each(&self, is_cancelled: &dyn Fn() -> bool) -> Vec<SourceInventory> {
        self.providers
            .iter()
            .map(|provider| SourceInventory {
                source: provider.source(),
                sessions: provider.discover(is_cancelled),
            })
            .collect()
    }

    /// Resolve an id through each provider in registration order.
    pub fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>> {
        Ok(self
            .resolve_with_provider(id)?
            .map(|resolved| resolved.locator))
    }

    /// Resolve an id, preferring the locator the index stored for it.
    ///
    /// The stored locator is used only when its source is registered, that
    /// provider [owns](SessionProvider::owns) it, and its path still exists.
    /// Otherwise every provider resolves the id afresh, so a row left over
    /// from a disabled source or an older root never reaches a command.
    pub fn locate(
        &self,
        id: &SessionId,
        stored: Option<SessionLocator>,
    ) -> Result<Option<ResolvedSession>> {
        if let Some(locator) = stored.filter(|locator| locator.id == *id)
            && let Some(provider) = self.get(locator.source)
            && provider.owns(&locator)
            && locator.primary_path.exists()
        {
            return Ok(Some(ResolvedSession {
                provider: Arc::clone(provider),
                locator,
            }));
        }
        self.resolve_with_provider(id)
    }

    fn resolve_with_provider(&self, id: &SessionId) -> Result<Option<ResolvedSession>> {
        for provider in &self.providers {
            if let Some(locator) = provider.resolve(id)? {
                return Ok(Some(ResolvedSession {
                    provider: Arc::clone(provider),
                    locator,
                }));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod locate_tests;
#[cfg(test)]
mod tests;
