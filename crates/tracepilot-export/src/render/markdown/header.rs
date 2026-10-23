//! Header, metadata-table and plan section writers.

use tracepilot_core::utils::{InfallibleWrite, truncate_utf8};

use crate::document::{PortableSession, PortableSessionMetadata, SessionArchive, SessionSource};

use super::{cell, format_dt, push_nested_markdown};

/// Longest title written in the H1, in bytes, before it is cut with `…`.
const MAX_TITLE_BYTES: usize = 120;

pub(super) fn write_header(md: &mut String, session: &PortableSession, archive: &SessionArchive) {
    let title = session
        .metadata
        .summary
        .as_deref()
        .and_then(title_of)
        .unwrap_or_else(|| session.metadata.id.clone());

    md.push_line(format_args!("# Session: {}", title));
    md.push('\n');
    md.push_line(format_args!(
        "> Exported by [{}](https://github.com/MattShelton04/TracePilot) on {} · Schema v{}",
        archive.header.exported_by,
        format_dt(&archive.header.exported_at),
        archive.header.schema_version,
    ));
    md.push_line(format_args!(">"));
    md.push_line(format_args!(
        "> Get [TracePilot](https://github.com/MattShelton04/TracePilot)"
    ));
    md.push('\n');
}

/// The summary's first non-empty line, trimmed and cut to
/// [`MAX_TITLE_BYTES`], with `…` when anything was left out. An untitled
/// Claude Code session's summary is its whole first prompt, whose later
/// lines (headings, lists) would otherwise land in the header.
fn title_of(summary: &str) -> Option<String> {
    let mut lines = summary.lines().map(str::trim).skip_while(|l| l.is_empty());
    let first = lines.next()?;
    let more = lines.any(|line| !line.is_empty());
    let title = truncate_utf8(first, MAX_TITLE_BYTES).trim_end();
    if more || title.len() < first.len() {
        Some(format!("{title}…"))
    } else {
        Some(title.to_string())
    }
}

pub(super) fn write_metadata(md: &mut String, meta: &PortableSessionMetadata) {
    md.push_line(format_args!("## Metadata\n"));
    md.push_line(format_args!("| Field | Value |"));
    md.push_line(format_args!("|-------|-------|"));
    md.push_line(format_args!("| ID | `{}` |", cell(&meta.id)));
    // Copilot is the default and stays unlabelled, as before other sources.
    if let Some(source) = source_label(meta.source) {
        md.push_line(format_args!("| Source | {} |", source));
    }

    if let Some(repo) = &meta.repository {
        md.push_line(format_args!("| Repository | {} |", cell(repo)));
    }
    if let Some(branch) = &meta.branch {
        md.push_line(format_args!("| Branch | {} |", cell(branch)));
    }
    if let Some(cwd) = &meta.cwd {
        md.push_line(format_args!("| Working Directory | `{}` |", cell(cwd)));
    }
    if let Some(host) = &meta.host_type {
        md.push_line(format_args!("| Host Type | {} |", cell(host)));
    }
    if let Some(created) = &meta.created_at {
        md.push_line(format_args!("| Created | {} |", format_dt(created)));
    }
    if let Some(updated) = &meta.updated_at {
        md.push_line(format_args!("| Updated | {} |", format_dt(updated)));
    }
    if let Some(events) = meta.event_count {
        md.push_line(format_args!("| Events | {} |", events));
    }
    if let Some(turns) = meta.turn_count {
        md.push_line(format_args!("| Turns | {} |", turns));
    }
    md.push('\n');
}

fn source_label(source: SessionSource) -> Option<&'static str> {
    match source {
        SessionSource::Copilot => None,
        SessionSource::ClaudeCode => Some("Claude Code"),
    }
}

pub(super) fn write_plan(md: &mut String, plan: &str) {
    md.push_line(format_args!("## Plan\n"));
    push_nested_markdown(md, plan, 2);
    md.push('\n');
}
