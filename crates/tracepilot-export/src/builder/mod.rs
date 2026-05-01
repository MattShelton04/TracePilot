//! Build a [`SessionArchive`] from session directories on disk.
//!
//! The builder reads session files using `tracepilot-core` parsers and
//! assembles a [`SessionArchive`] according to the user's [`crate::options::ExportOptions`].
//! Only requested sections are loaded, keeping memory usage proportional
//! to what the user actually wants to export.

mod archive;
mod header;
mod sections;
mod session;

pub use archive::{build_session_archive, build_session_archive_batch};
