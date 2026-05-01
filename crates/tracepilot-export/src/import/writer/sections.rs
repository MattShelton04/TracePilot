use std::path::Path;

use crate::document::{PortableSession, SessionArchive};
use crate::error::Result;

use super::database::write_session_db;
use super::filesystem::{write_checkpoints, write_events_jsonl, write_plan};
use super::workspace::write_workspace_yaml;

pub(super) fn write_session_files(
    session: &PortableSession,
    archive: &SessionArchive,
    dir: &Path,
    target_session_id: &str,
) -> Result<()> {
    // 1. workspace.yaml (always written)
    write_workspace_yaml(session, archive, dir, target_session_id)?;

    // 2. events.jsonl
    if let Some(events) = &session.events {
        write_events_jsonl(events, dir)?;
    }

    // 3. plan.md
    if let Some(plan) = &session.plan {
        write_plan(plan, dir)?;
    }

    // 4. checkpoints/
    if let Some(checkpoints) = &session.checkpoints {
        write_checkpoints(checkpoints, dir)?;
    }

    // 5. session.db (todos)
    if let Some(todos) = &session.todos {
        write_session_db(todos, dir)?;
    }

    Ok(())
}
