use std::fs;
use std::path::Path;

use crate::document::{CheckpointExport, RawEvent};
use crate::error::{ExportError, Result};

pub(super) fn write_events_jsonl(events: &[RawEvent], dir: &Path) -> Result<()> {
    let path = dir.join("events.jsonl");
    let mut content = String::with_capacity(events.len() * 256);

    for event in events {
        let line = serde_json::to_string(event).map_err(|e| ExportError::Render {
            format: "JSONL".to_string(),
            message: e.to_string(),
        })?;
        content.push_str(&line);
        content.push('\n');
    }

    fs::write(&path, content).map_err(|e| ExportError::io(&path, e))
}

pub(super) fn write_plan(plan: &str, dir: &Path) -> Result<()> {
    let path = dir.join("plan.md");
    fs::write(&path, plan).map_err(|e| ExportError::io(&path, e))
}

pub(super) fn write_checkpoints(checkpoints: &[CheckpointExport], dir: &Path) -> Result<()> {
    let cp_dir = dir.join("checkpoints");
    fs::create_dir_all(&cp_dir).map_err(|e| ExportError::io(&cp_dir, e))?;

    // Write index.md
    let mut index = String::from("| # | Title | File |\n| --- | --- | --- |\n");
    for cp in checkpoints {
        index.push_str(&format!(
            "| {} | {} | {} |\n",
            cp.number, cp.title, cp.filename
        ));
    }
    let index_path = cp_dir.join("index.md");
    fs::write(&index_path, &index).map_err(|e| ExportError::io(&index_path, e))?;

    // Write individual checkpoint files
    for cp in checkpoints {
        if let Some(content) = &cp.content {
            let cp_path = cp_dir.join(&cp.filename);
            fs::write(&cp_path, content).map_err(|e| ExportError::io(&cp_path, e))?;
        }
    }

    Ok(())
}
