//! Build a [`SessionArchive`] from Copilot session directories on disk or
//! from sessions another provider has loaded ([`ProviderSession`]).
//!
//! The builder reads session files using `tracepilot-core` parsers and
//! assembles a [`SessionArchive`] according to the user's [`crate::options::ExportOptions`].
//! Only requested sections are loaded, keeping memory usage proportional
//! to what the user actually wants to export.

mod archive;
mod header;
mod provider;
mod sections;
mod session;

pub use archive::{ExportInput, build_archive, build_session_archive, build_session_archive_batch};
pub use provider::ProviderSession;
