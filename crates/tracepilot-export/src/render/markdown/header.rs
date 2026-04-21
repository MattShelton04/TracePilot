//! Header, metadata-table and plan section writers.

use std::fmt::Write;

use crate::document::{PortableSession, PortableSessionMetadata, SessionArchive};

use super::format_dt;

pub(super) fn write_header(md: &mut String, session: &PortableSession, archive: &SessionArchive) {
    let title = session
        .metadata
        .summary
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&session.metadata.id);

    let _ = writeln!(md, "# Session: {}", title);
    md.push('\n');
    let _ = writeln!(
        md,
        "> Exported by [{}](https://github.com/MattShelton04/TracePilot) on {} · Schema v{}",
        archive.header.exported_by,
        format_dt(&archive.header.exported_at),
        archive.header.schema_version,
    );
    let _ = writeln!(md, ">");
    let _ = writeln!(
        md,
        "> Get [TracePilot](https://github.com/MattShelton04/TracePilot)"
    );
    md.push('\n');
}

pub(super) fn write_metadata(md: &mut String, meta: &PortableSessionMetadata) {
    let _ = writeln!(md, "## Metadata\n");
    let _ = writeln!(md, "| Field | Value |");
    let _ = writeln!(md, "|-------|-------|");
    let _ = writeln!(md, "| ID | `{}` |", meta.id);

    if let Some(repo) = &meta.repository {
        let _ = writeln!(md, "| Repository | {} |", repo);
    }
    if let Some(branch) = &meta.branch {
        let _ = writeln!(md, "| Branch | {} |", branch);
    }
    if let Some(cwd) = &meta.cwd {
        let _ = writeln!(md, "| Working Directory | `{}` |", cwd);
    }
    if let Some(host) = &meta.host_type {
        let _ = writeln!(md, "| Host Type | {} |", host);
    }
    if let Some(created) = &meta.created_at {
        let _ = writeln!(md, "| Created | {} |", format_dt(created));
    }
    if let Some(updated) = &meta.updated_at {
        let _ = writeln!(md, "| Updated | {} |", format_dt(updated));
    }
    if let Some(events) = meta.event_count {
        let _ = writeln!(md, "| Events | {} |", events);
    }
    if let Some(turns) = meta.turn_count {
        let _ = writeln!(md, "| Turns | {} |", turns);
    }
    md.push('\n');
}

pub(super) fn write_plan(md: &mut String, plan: &str) {
    let _ = writeln!(md, "## Plan\n");
    for line in plan.lines() {
        if line.starts_with('#') {
            let _ = writeln!(md, "##{}", line);
        } else {
            let _ = writeln!(md, "{}", line);
        }
    }
    md.push('\n');
}
