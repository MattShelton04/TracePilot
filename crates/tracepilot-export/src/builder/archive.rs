use std::path::Path;

use crate::document::SessionArchive;
use crate::error::Result;
use crate::options::ExportOptions;

use super::header::{build_header, build_options_record};
use super::session::build_portable_session;

/// Build a [`SessionArchive`] from one session directory.
pub fn build_session_archive(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<SessionArchive> {
    let session = build_portable_session(session_dir, options)?;

    Ok(SessionArchive {
        header: build_header(options),
        sessions: vec![session],
        export_options: build_options_record(options),
    })
}

/// Build a [`SessionArchive`] from multiple session directories (batch export).
pub fn build_session_archive_batch(
    session_dirs: &[&Path],
    options: &ExportOptions,
) -> Result<SessionArchive> {
    let mut sessions = Vec::with_capacity(session_dirs.len());
    for dir in session_dirs {
        sessions.push(build_portable_session(dir, options)?);
    }

    Ok(SessionArchive {
        header: build_header(options),
        sessions,
        export_options: build_options_record(options),
    })
}
