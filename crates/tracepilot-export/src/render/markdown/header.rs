//! Header, metadata-table and plan section writers.

use tracepilot_core::utils::InfallibleWrite;

use crate::document::{PortableSession, PortableSessionMetadata, SessionArchive};

use super::format_dt;

pub(super) fn write_header(md: &mut String, session: &PortableSession, archive: &SessionArchive) {
    let title = session
        .metadata
        .summary
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&session.metadata.id);

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

pub(super) fn write_metadata(md: &mut String, meta: &PortableSessionMetadata) {
    md.push_line(format_args!("## Metadata\n"));
    md.push_line(format_args!("| Field | Value |"));
    md.push_line(format_args!("|-------|-------|"));
    md.push_line(format_args!("| ID | `{}` |", meta.id));

    if let Some(repo) = &meta.repository {
        md.push_line(format_args!("| Repository | {} |", repo));
    }
    if let Some(branch) = &meta.branch {
        md.push_line(format_args!("| Branch | {} |", branch));
    }
    if let Some(cwd) = &meta.cwd {
        md.push_line(format_args!("| Working Directory | `{}` |", cwd));
    }
    if let Some(host) = &meta.host_type {
        md.push_line(format_args!("| Host Type | {} |", host));
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

pub(super) fn write_plan(md: &mut String, plan: &str) {
    md.push_line(format_args!("## Plan\n"));
    for line in plan.lines() {
        if line.starts_with('#') {
            md.push_line(format_args!("##{}", line));
        } else {
            md.push_line(format_args!("{}", line));
        }
    }
    md.push('\n');
}
