use std::path::Path;

use crate::document::{PortableSession, SessionArchive};
use crate::error::Result;
use crate::options::ExportOptions;

use super::header::{build_header, build_options_record};
use super::provider::{ProviderSession, build_provider_session};
use super::session::build_portable_session;

/// One session to export.
pub enum ExportInput<'a> {
    /// A Copilot session directory, read in its own layout.
    Directory(&'a Path),
    /// A session another provider has loaded.
    Provider(ProviderSession<'a>),
}

/// Build a [`SessionArchive`] from one session directory.
pub fn build_session_archive(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<SessionArchive> {
    build_archive(&[ExportInput::Directory(session_dir)], options)
}

/// Build a [`SessionArchive`] from multiple session directories (batch export).
pub fn build_session_archive_batch(
    session_dirs: &[&Path],
    options: &ExportOptions,
) -> Result<SessionArchive> {
    let inputs: Vec<_> = session_dirs
        .iter()
        .map(|dir| ExportInput::Directory(dir))
        .collect();
    build_archive(&inputs, options)
}

/// Build a [`SessionArchive`] from sessions of any source.
pub fn build_archive(
    inputs: &[ExportInput<'_>],
    options: &ExportOptions,
) -> Result<SessionArchive> {
    let mut sessions = Vec::with_capacity(inputs.len());
    for input in inputs {
        sessions.push(build_session(input, options)?);
    }

    Ok(SessionArchive {
        header: build_header(options),
        sessions,
        export_options: build_options_record(options),
    })
}

fn build_session(input: &ExportInput<'_>, options: &ExportOptions) -> Result<PortableSession> {
    match input {
        ExportInput::Directory(dir) => build_portable_session(dir, options),
        ExportInput::Provider(session) => Ok(build_provider_session(session, options)),
    }
}
