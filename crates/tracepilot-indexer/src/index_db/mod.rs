//! Local SQLite index database with FTS5 and incremental analytics.
//!
//! Decomposed into focused sub-modules:
//! - `types` — public/private structs and constants
//! - `open` — `open_or_create`, `open_readonly`, transaction delimiters,
//!   incremental auto_vacuum conversion
//! - `maintenance` — `ANALYZE`, FTS optimize, incremental vacuum, WAL
//!   checkpoint, epoch-throttled scheduling
//! - `migrations` — schema migration runner (`MIGRATION_1..n`)
//! - `helpers` — SQL filter builders, day-query functions, duration stats
//! - `session_writer` / `session_reader` — per-session ingest and reads
//! - `search_writer` / `search_reader` — FTS5 content and search surface
//! - `analytics_queries` — aggregate analytics, tool analysis, code impact

mod analytics_queries;
pub(crate) mod batch_insert;
mod helpers;
mod maintenance;
mod migrations;
mod open;
mod row_helpers;
pub mod search_reader;
pub mod search_writer;
mod session_reader;
pub(crate) mod session_writer;
#[cfg(test)]
mod tests;
mod types;

use rusqlite::Connection;

// Re-export public types used by callers (lib.rs, tauri-bindings).
pub use search_reader::{
    ContextSnippet, FtsHealthInfo, SearchFacets, SearchFilters, SearchResult, SearchStats,
};
pub use search_writer::CURRENT_EXTRACTOR_VERSION;
pub use types::{IndexedIncident, IndexedSession, SessionIndexInfo};

pub struct IndexDb {
    pub(crate) conn: Connection,
}
