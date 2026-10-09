//! The session's latest plan, from plan mode.
//!
//! `ExitPlanMode` carries the plan as its `input.plan` (older clients) and
//! its result's `toolUseResult.plan` (the text the user approved, possibly
//! edited). The last of these in the transcript wins. When a session used
//! plan mode but recorded no text, the plan file Claude Code keeps at
//! `plans/<slug>.md` is the fallback; the record's own `filePath` is never
//! followed.

use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;

use super::reader::Line;
use super::records::{Blocks, Rec, block_type};
use crate::provider::PlanArtifact;

const EXIT_PLAN_MODE: &str = "ExitPlanMode";
const ENTER_PLAN_MODE: &str = "EnterPlanMode";

/// The latest plan in `lines`, or the plan file under `plans_dir`.
pub(super) fn latest_plan(lines: &[Line], plans_dir: &Path) -> Option<PlanArtifact> {
    let mut exit_calls: HashSet<&str> = HashSet::new();
    let mut latest: Option<&str> = None;
    let mut used_plan_mode = false;
    let mut slug: Option<&str> = None;
    for line in lines {
        let rec = Rec(&line.value);
        if let Some(value) = rec.str("slug") {
            slug = Some(value);
        }
        let Blocks::Array(blocks) = rec.blocks() else {
            continue;
        };
        for block in blocks {
            match block_type(block) {
                "tool_use" => match block.get("name").and_then(Value::as_str) {
                    Some(EXIT_PLAN_MODE) => {
                        used_plan_mode = true;
                        if let Some(id) = block.get("id").and_then(Value::as_str) {
                            exit_calls.insert(id);
                        }
                        latest = plan_text(block.pointer("/input/plan")).or(latest);
                    }
                    Some(ENTER_PLAN_MODE) => used_plan_mode = true,
                    _ => {}
                },
                "tool_result" => {
                    let id = block.get("tool_use_id").and_then(Value::as_str);
                    if id.is_some_and(|id| exit_calls.contains(id)) {
                        latest = plan_text(rec.0.pointer("/toolUseResult/plan")).or(latest);
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(text) = latest {
        return Some(PlanArtifact::Inline(text.to_string()));
    }
    if !used_plan_mode {
        return None;
    }
    plan_file(plans_dir, slug?).map(PlanArtifact::File)
}

fn plan_text(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
}

/// `plans_dir/<slug>.md` when the slug is a plain name and the file resolves
/// inside `plans_dir`.
fn plan_file(plans_dir: &Path, slug: &str) -> Option<std::path::PathBuf> {
    let plain = !slug.is_empty()
        && slug.len() <= 128
        && slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'));
    if !plain {
        return None;
    }
    let dir = plans_dir.canonicalize().ok()?;
    let file = plans_dir.join(format!("{slug}.md")).canonicalize().ok()?;
    (file.parent() == Some(dir.as_path()) && file.is_file()).then_some(file)
}
