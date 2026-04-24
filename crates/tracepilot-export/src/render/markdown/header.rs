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

    writeln!(md, "# Session: {}", title).expect("writeln to String is infallible");
    md.push('\n');
    writeln!(
        md,
        "> Exported by [{}](https://github.com/MattShelton04/TracePilot) on {} · Schema v{}",
        archive.header.exported_by,
        format_dt(&archive.header.exported_at),
        archive.header.schema_version,
    )
    .expect("writeln to String is infallible");
    writeln!(md, ">").expect("writeln to String is infallible");
    writeln!(
        md,
        "> Get [TracePilot](https://github.com/MattShelton04/TracePilot)"
    )
    .expect("writeln to String is infallible");
    md.push('\n');
}

pub(super) fn write_metadata(md: &mut String, meta: &PortableSessionMetadata) {
    writeln!(md, "## Metadata\n").expect("writeln to String is infallible");
    writeln!(md, "| Field | Value |").expect("writeln to String is infallible");
    writeln!(md, "|-------|-------|").expect("writeln to String is infallible");
    writeln!(md, "| ID | `{}` |", meta.id).expect("writeln to String is infallible");

    if let Some(repo) = &meta.repository {
        writeln!(md, "| Repository | {} |", repo).expect("writeln to String is infallible");
    }
    if let Some(branch) = &meta.branch {
        writeln!(md, "| Branch | {} |", branch).expect("writeln to String is infallible");
    }
    if let Some(cwd) = &meta.cwd {
        writeln!(md, "| Working Directory | `{}` |", cwd).expect("writeln to String is infallible");
    }
    if let Some(host) = &meta.host_type {
        writeln!(md, "| Host Type | {} |", host).expect("writeln to String is infallible");
    }
    if let Some(created) = &meta.created_at {
        writeln!(md, "| Created | {} |", format_dt(created))
            .expect("writeln to String is infallible");
    }
    if let Some(updated) = &meta.updated_at {
        writeln!(md, "| Updated | {} |", format_dt(updated))
            .expect("writeln to String is infallible");
    }
    if let Some(events) = meta.event_count {
        writeln!(md, "| Events | {} |", events).expect("writeln to String is infallible");
    }
    if let Some(turns) = meta.turn_count {
        writeln!(md, "| Turns | {} |", turns).expect("writeln to String is infallible");
    }
    md.push('\n');
}

pub(super) fn write_plan(md: &mut String, plan: &str) {
    writeln!(md, "## Plan\n").expect("writeln to String is infallible");
    for line in plan.lines() {
        if line.starts_with('#') {
            writeln!(md, "##{}", line).expect("writeln to String is infallible");
        } else {
            writeln!(md, "{}", line).expect("writeln to String is infallible");
        }
    }
    md.push('\n');
}
