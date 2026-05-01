//! Import pipeline for `.tpx.json` session archives.
//!
//! # Pipeline
//!
//! ```text
//! .tpx.json → Parser → Migrator → Validator → Writer → session directory
//! ```
//!
//! The import pipeline reverses the export pipeline: it reads a `.tpx.json`
//! file, validates it, optionally migrates the schema forward, and writes
//! the session data to a standard session directory that existing parsers
//! can read.
//!
//! # Usage
//!
//! ```ignore
//! use tracepilot_export::import::{preview_import, import_sessions, ImportOptions, ConflictStrategy};
//!
//! // Preview without writing
//! let preview = preview_import(Path::new("export.tpx.json"))?;
//! println!("{} sessions, {} issues", preview.session_count, preview.issues.len());
//!
//! // Import
//! let options = ImportOptions::default();
//! let result = import_sessions(Path::new("export.tpx.json"), Path::new("./sessions"), &options)?;
//! println!("Imported {} sessions", result.imported.len());
//! ```

pub mod migrator;
pub mod parser;
pub mod validator;
pub mod writer;

mod duplicate;
mod options;
mod orchestrator;
mod types;

#[cfg(test)]
mod tests;

pub use migrator::MigrationStatus;
pub use options::{ConflictStrategy, ImportOptions};
pub use orchestrator::{import_sessions, preview_import};
pub use types::{
    ImportPreview, ImportResult, ImportSessionSummary, ImportedSession, SkipReason, SkippedSession,
};
pub use validator::{IssueSeverity, ValidationIssue};
