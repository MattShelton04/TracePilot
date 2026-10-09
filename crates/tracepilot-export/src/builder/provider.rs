//! Build a [`PortableSession`] from a session a provider has loaded.
//!
//! Sources other than Copilot have no `workspace.yaml`, `session.db` or
//! session directory, so metadata comes from the snapshot's summary and side
//! files from the provider's [`SessionArtifacts`]. Event records pass through
//! [`redact_native_record`] first.

use tracepilot_core::parsing::events::{RawEvent, TypedEvent};
use tracepilot_core::provider::{
    ProviderSnapshot, SessionArtifacts, SessionSource, redact_native_record,
};
use tracepilot_core::turns::reconstruct_turns;

use crate::document::{
    PortableSession, PortableSessionMetadata, SectionId, TodoDepExport, TodoExport, TodoItemExport,
};
use crate::options::ExportOptions;

use super::sections::{
    build_conversation, build_events, build_incidents, build_parse_diagnostics, build_plan_file,
    checkpoint_exports,
};

/// A session loaded through its provider, for sources without Copilot's
/// directory layout.
pub struct ProviderSession<'a> {
    pub source: SessionSource,
    pub snapshot: &'a ProviderSnapshot,
    pub artifacts: &'a SessionArtifacts,
}

pub(super) fn build_provider_session(
    session: &ProviderSession<'_>,
    options: &ExportOptions,
) -> PortableSession {
    let snapshot = session.snapshot;
    let summary = &snapshot.summary;
    let events = snapshot.events.as_deref();

    let turn_count = snapshot
        .turns
        .as_ref()
        .map(Vec::len)
        .or_else(|| events.map(|events| reconstruct_turns(events).len()));
    let metadata = PortableSessionMetadata {
        id: summary.id.clone(),
        source: session.source,
        summary: summary.summary.clone(),
        repository: summary.repository.clone(),
        branch: summary.branch.clone(),
        cwd: summary.cwd.clone(),
        git_root: None,
        host_type: summary.host_type.clone(),
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        event_count: Some(events.map_or(0, <[TypedEvent]>::len)),
        turn_count,
        summary_count: None,
        lineage: None,
    };

    let mut available_sections = Vec::new();
    let available = &mut available_sections;
    let raw_events = if options.includes(SectionId::Events) {
        events.map(redacted_records)
    } else {
        None
    };
    let artifacts = session.artifacts;

    PortableSession {
        metadata,
        conversation: build_conversation(options, events, available),
        events: build_events(options, raw_events, available),
        todos: build_todos(options, artifacts, available),
        plan: artifacts
            .plan
            .as_deref()
            .and_then(|path| build_plan_file(options, path, available)),
        checkpoints: options
            .includes(SectionId::Checkpoints)
            .then(|| artifacts.checkpoints.clone())
            .flatten()
            .and_then(|index| checkpoint_exports(index, available)),
        rewind_snapshots: build_rewind(options, artifacts, available),
        shutdown_metrics: options
            .includes(SectionId::Metrics)
            .then(|| summary.shutdown_metrics.clone())
            .flatten()
            .inspect(|_| available.push(SectionId::Metrics)),
        incidents: build_incidents(options, events, available),
        // Custom tables are tables of Copilot's `session.db`.
        custom_tables: None,
        parse_diagnostics: build_parse_diagnostics(
            options,
            snapshot.diagnostics.as_ref(),
            events.map_or(0, <[TypedEvent]>::len),
            available,
        ),
        available_sections,
        extensions: None,
    }
}

fn redacted_records(events: &[TypedEvent]) -> Vec<RawEvent> {
    events
        .iter()
        .map(|event| {
            let mut raw = event.raw.clone();
            redact_native_record(&mut raw);
            raw
        })
        .collect()
}

fn build_todos(
    options: &ExportOptions,
    artifacts: &SessionArtifacts,
    available: &mut Vec<SectionId>,
) -> Option<TodoExport> {
    if !options.includes(SectionId::Todos) {
        return None;
    }
    let todos = artifacts.todos.clone()?;
    let export = TodoExport {
        items: todos.items.into_iter().map(TodoItemExport::from).collect(),
        deps: todos
            .deps
            .unwrap_or_default()
            .into_iter()
            .map(TodoDepExport::from)
            .collect(),
    };
    if !export.items.is_empty() {
        available.push(SectionId::Todos);
    }
    Some(export)
}

fn build_rewind(
    options: &ExportOptions,
    artifacts: &SessionArtifacts,
    available: &mut Vec<SectionId>,
) -> Option<crate::document::RewindIndex> {
    if !options.includes(SectionId::RewindSnapshots) {
        return None;
    }
    let index = artifacts.rewind.clone()?;
    if !index.snapshots.is_empty() {
        available.push(SectionId::RewindSnapshots);
    }
    Some(index)
}
