use std::path::Path;

use crate::document::{CheckpointExport, RewindIndex, SectionId};
use crate::options::ExportOptions;
use tracepilot_core::parsing::checkpoints::parse_checkpoints;
use tracepilot_core::parsing::rewind_snapshots::parse_rewind_index;

pub(in crate::builder) fn build_plan(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<String> {
    if !options.includes(SectionId::Plan) {
        return None;
    }
    let plan_path = session_dir.join("plan.md");
    match std::fs::read_to_string(&plan_path) {
        Ok(content) if !content.trim().is_empty() => {
            available.push(SectionId::Plan);
            Some(content)
        }
        Ok(_) => None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            tracing::warn!(
                path = %plan_path.display(),
                error = %e,
                "Failed to read plan file, skipping section"
            );
            None
        }
    }
}

pub(in crate::builder) fn build_checkpoints(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<Vec<CheckpointExport>> {
    if !options.includes(SectionId::Checkpoints) {
        return None;
    }
    let index = match parse_checkpoints(session_dir) {
        Ok(Some(idx)) => idx,
        Ok(None) => return None,
        Err(e) => {
            tracing::warn!(
                path = %session_dir.join("checkpoints").join("index.md").display(),
                error = %e,
                "Failed to read or parse checkpoints, skipping section"
            );
            return None;
        }
    };
    let exports = index
        .checkpoints
        .into_iter()
        .map(|cp| CheckpointExport {
            number: cp.number,
            title: cp.title,
            filename: cp.filename,
            content: cp.content,
        })
        .collect::<Vec<_>>();

    if !exports.is_empty() {
        available.push(SectionId::Checkpoints);
    }
    Some(exports)
}

pub(in crate::builder) fn build_rewind_snapshots(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<RewindIndex> {
    if !options.includes(SectionId::RewindSnapshots) {
        return None;
    }
    let index = match parse_rewind_index(session_dir) {
        Ok(Some(idx)) => idx,
        Ok(None) => return None,
        Err(e) => {
            tracing::warn!(
                path = %session_dir.join("rewind-snapshots").join("index.json").display(),
                error = %e,
                "Failed to read or parse rewind snapshots, skipping section"
            );
            return None;
        }
    };
    if !index.snapshots.is_empty() {
        available.push(SectionId::RewindSnapshots);
    }
    Some(index)
}
