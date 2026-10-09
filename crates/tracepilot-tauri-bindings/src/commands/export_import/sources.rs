//! Sessions loaded for export. Copilot sessions are read from their
//! directory, as before; other sources export from their provider snapshot.

use std::path::PathBuf;

use tracepilot_core::SessionId;
use tracepilot_core::provider::{
    ProviderSnapshot, ResolvedSession, SessionArtifacts, SessionSource,
};
use tracepilot_export::{ExportInput, ProviderSession};

use crate::error::CmdResult;
use crate::types::SessionSectionsInfo;

/// Event types the Incidents section is built from.
pub(super) const INCIDENT_TYPES: &[&str] = &[
    "session.error",
    "session.warning",
    "session.compaction_complete",
    "session.truncation",
];

pub(super) enum ExportSession {
    Directory(PathBuf),
    Provider {
        source: SessionSource,
        snapshot: Box<ProviderSnapshot>,
        artifacts: SessionArtifacts,
    },
}

impl ExportSession {
    /// A best-effort load, like the session views: skipped lines are
    /// reported in the Parse Diagnostics section.
    pub(super) fn load(session: ResolvedSession) -> CmdResult<Self> {
        let ResolvedSession { provider, locator } = session;
        if locator.source == SessionSource::Copilot {
            return Ok(Self::Directory(locator.primary_path));
        }
        let snapshot = provider.load_snapshot(&locator, false, &|| false)?;
        let artifacts = provider.artifacts(&locator)?;
        Ok(Self::Provider {
            source: locator.source,
            snapshot: Box::new(snapshot),
            artifacts,
        })
    }

    pub(super) fn input(&self) -> ExportInput<'_> {
        match self {
            Self::Directory(dir) => ExportInput::Directory(dir),
            Self::Provider {
                source,
                snapshot,
                artifacts,
            } => ExportInput::Provider(ProviderSession {
                source: *source,
                snapshot,
                artifacts,
            }),
        }
    }
}

/// Which sections have data, for a session a provider loaded.
pub(super) fn provider_sections(
    session_id: SessionId,
    snapshot: &ProviderSnapshot,
    artifacts: &SessionArtifacts,
) -> SessionSectionsInfo {
    let events = snapshot.events.as_deref().unwrap_or_default();
    let has_events = !events.is_empty();
    SessionSectionsInfo {
        session_id,
        has_conversation: has_events,
        has_events,
        has_todos: artifacts
            .todos
            .as_ref()
            .is_some_and(|todos| !todos.items.is_empty()),
        has_plan: artifacts
            .plan
            .as_ref()
            .is_some_and(|plan| plan.metadata().map(|meta| meta.len() > 0).unwrap_or(false)),
        has_checkpoints: artifacts
            .checkpoints
            .as_ref()
            .is_some_and(|index| !index.checkpoints.is_empty()),
        has_metrics: snapshot.summary.shutdown_metrics.is_some(),
        has_incidents: events
            .iter()
            .any(|event| INCIDENT_TYPES.contains(&event.raw.event_type.as_str())),
        has_rewind_snapshots: artifacts
            .rewind
            .as_ref()
            .is_some_and(|index| !index.snapshots.is_empty()),
        has_custom_tables: false,
        event_count: Some(events.len()),
        turn_count: snapshot.turns.as_ref().map(Vec::len),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;
    use tracepilot_core::provider::SessionProvider;
    use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
    use tracepilot_export::options::{ExportFormat, ExportOptions};

    use super::*;

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    fn claude_session(dir: &std::path::Path) -> ResolvedSession {
        let project = dir.join("projects").join("demo");
        std::fs::create_dir_all(&project).unwrap();
        let context = json!({"type":"attachment","uuid":"ctx","sessionId":ID,
            "timestamp":"2026-09-20T10:00:00Z",
            "attachment":{"type":"session_context","context":{"userEmail":"dev@example.com"}}});
        let user = json!({"type":"user","uuid":"first","sessionId":ID,
            "timestamp":"2026-09-20T10:00:01Z","message":{"role":"user","content":"Hello."}});
        let cost = json!({"type":"cost-state","totalCostUSD":1.25,"totalAPIDuration":123,
            "totalDuration":200,"modelUsage":{"claude-opus-5-5":{"inputTokens":1,
                "outputTokens":4}}});
        std::fs::write(
            project.join(format!("{ID}.jsonl")),
            format!("{context}\n{user}\n{cost}\n"),
        )
        .unwrap();
        let provider = Arc::new(ClaudeCodeProvider::new(dir));
        let locator = provider.discover(&|| false).unwrap().remove(0);
        ResolvedSession { provider, locator }
    }

    #[test]
    fn claude_sessions_export_from_their_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let session = ExportSession::load(claude_session(dir.path())).unwrap();
        let ExportSession::Provider {
            source,
            snapshot,
            artifacts,
        } = &session
        else {
            panic!("a Claude Code session loads through its provider");
        };
        assert_eq!(*source, SessionSource::ClaudeCode);

        let sections = provider_sections(SessionId::from_validated(ID), snapshot, artifacts);
        assert!(sections.has_conversation && sections.has_events && sections.has_metrics);
        assert!(!sections.has_custom_tables && !sections.has_todos && !sections.has_plan);
        assert_eq!(
            sections.event_count,
            Some(snapshot.events.as_ref().unwrap().len())
        );

        let options = ExportOptions::all(ExportFormat::Json);
        let files = tracepilot_export::export_inputs(&[session.input()], &options).unwrap();
        let output = files[0].as_text().unwrap();
        assert!(output.contains(r#""source": "claudeCode""#));
        assert!(output.contains("Hello."));
        assert!(!output.contains("dev@example.com"));
    }
}
