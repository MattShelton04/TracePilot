//! What this particular store file can actually answer.
//!
//! The source's own `schema_version` has been observed at 1 and at 8 for
//! stores that differ by a single added column, so it is recorded as a
//! diagnostic and never used as a contract. What the adapter relies on is the
//! set of tables and columns that are really there, probed once per open.
//!
//! Capabilities are granular on purpose. A store missing `output_ttft_ms`
//! should still produce a request ledger with that one cell shown as
//! unavailable, not disable the feature.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Source table holding one row per model request.
pub const TABLE_USAGE: &str = "assistant_usage_events";
/// Source table holding extracted PR, issue and commit references.
pub const TABLE_REFS: &str = "session_refs";
/// Source table holding session metadata.
pub const TABLE_SESSIONS: &str = "sessions";
/// Source table holding the flattened user/assistant turn text.
pub const TABLE_TURNS: &str = "turns";
/// Source table holding structured compaction summaries.
pub const TABLE_CHECKPOINTS: &str = "checkpoints";

/// Columns the adapter will read from `assistant_usage_events`, in projection
/// order. Anything outside this list is never selected, however interesting.
pub const USAGE_COLUMNS: &[&str] = &[
    "id",
    "session_id",
    "turn_index",
    "agent_id",
    "parent_tool_call_id",
    "model",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "total_nano_aiu",
    "request_multiplier",
    "duration_ms",
    "time_to_first_token_ms",
    "output_ttft_ms",
    "inter_token_latency_ms",
    "initiator",
    "api_endpoint",
    "reasoning_effort",
    "finish_reason",
    "content_filter_triggered",
    "token_details_json",
    "created_at",
    "copilot_usage_model",
];

/// Columns required before the request ledger is offered at all.
pub const USAGE_REQUIRED: &[&str] = &["id", "session_id", "model"];

pub const REFS_COLUMNS: &[&str] = &[
    "id",
    "session_id",
    "ref_type",
    "ref_value",
    "turn_index",
    "created_at",
];

pub const REFS_REQUIRED: &[&str] = &["session_id", "ref_type", "ref_value"];

pub const SESSION_COLUMNS: &[&str] = &[
    "id",
    "cwd",
    "repository",
    "host_type",
    "branch",
    "summary",
    "created_at",
    "updated_at",
];

pub const SESSION_REQUIRED: &[&str] = &["id"];

/// The tables and columns one store file offers, plus its recorded version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCapabilities {
    /// `schema_version.version`, for diagnostics only.
    pub schema_version: Option<i64>,
    /// Allowlisted columns found, per table. Columns outside the allowlists
    /// are not recorded, so an unrelated CLI addition cannot change the
    /// fingerprint and force a needless refresh.
    tables: BTreeMap<String, BTreeSet<String>>,
    /// Hash over the recorded table/column signature. A change here means the
    /// source's shape moved and capabilities must be re-derived.
    pub fingerprint: String,
}

impl StoreCapabilities {
    /// Probe a connection. Only reads `sqlite_master` and `PRAGMA table_info`.
    pub fn probe(conn: &Connection) -> rusqlite::Result<Self> {
        let present = present_tables(conn)?;
        let mut tables: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (table, allowlist) in allowlists() {
            if !present.contains(table) {
                continue;
            }
            let columns = table_columns(conn, table)?;
            let kept: BTreeSet<String> = allowlist
                .iter()
                .filter(|column| columns.contains(**column))
                .map(|column| (*column).to_string())
                .collect();
            tables.insert(table.to_string(), kept);
        }
        // Tables read only for presence, so a later feature can light up
        // without another schema round trip.
        for table in [TABLE_TURNS, TABLE_CHECKPOINTS] {
            if present.contains(table) {
                tables.entry(table.to_string()).or_default();
            }
        }
        let schema_version = read_schema_version(conn, &present);
        let fingerprint = fingerprint_of(&tables, schema_version);
        Ok(Self {
            schema_version,
            tables,
            fingerprint,
        })
    }

    pub fn has_table(&self, table: &str) -> bool {
        self.tables.contains_key(table)
    }

    pub fn has_column(&self, table: &str, column: &str) -> bool {
        self.tables
            .get(table)
            .is_some_and(|columns| columns.contains(column))
    }

    /// Whether every column in `required` is present on `table`.
    pub fn supports(&self, table: &str, required: &[&str]) -> bool {
        self.has_table(table) && required.iter().all(|column| self.has_column(table, column))
    }

    pub fn supports_requests(&self) -> bool {
        self.supports(TABLE_USAGE, USAGE_REQUIRED)
    }

    pub fn supports_work_refs(&self) -> bool {
        self.supports(TABLE_REFS, REFS_REQUIRED)
    }

    pub fn supports_sessions(&self) -> bool {
        self.supports(TABLE_SESSIONS, SESSION_REQUIRED)
    }

    /// Whether the store offers nothing this build can use, which is the
    /// `Incompatible` rather than `Ready` case.
    pub fn is_unusable(&self) -> bool {
        !self.supports_requests() && !self.supports_work_refs() && !self.supports_sessions()
    }

    /// An explicit projection over `columns`, substituting `NULL` for any this
    /// source lacks so that column indices stay fixed across schema versions.
    ///
    /// Identifiers come from the compile-time allowlists above, never from the
    /// source or from user input.
    pub fn projection(&self, table: &str, columns: &[&str]) -> String {
        columns
            .iter()
            .map(|column| {
                if self.has_column(table, column) {
                    format!("\"{column}\"")
                } else {
                    format!("NULL AS \"{column}\"")
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// Names of allowlisted columns this source does not have, for the status
    /// surface. Ordered, so the diagnostic is stable between runs.
    pub fn missing_columns(&self, table: &str, columns: &[&str]) -> Vec<String> {
        columns
            .iter()
            .filter(|column| !self.has_column(table, column))
            .map(|column| (*column).to_string())
            .collect()
    }
}

fn allowlists() -> [(&'static str, &'static [&'static str]); 3] {
    [
        (TABLE_USAGE, USAGE_COLUMNS),
        (TABLE_REFS, REFS_COLUMNS),
        (TABLE_SESSIONS, SESSION_COLUMNS),
    ]
}

fn present_tables(conn: &Connection) -> rusqlite::Result<BTreeSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut names = BTreeSet::new();
    for name in rows {
        names.insert(name?);
    }
    Ok(names)
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<BTreeSet<String>> {
    // PRAGMA cannot be parameterised. `table` is always one of the constants
    // above, and the quote doubling keeps that true even if that changes.
    let sql = format!("PRAGMA table_info('{}')", table.replace('\'', "''"));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut columns = BTreeSet::new();
    for column in rows {
        columns.insert(column?);
    }
    Ok(columns)
}

fn read_schema_version(conn: &Connection, present: &BTreeSet<String>) -> Option<i64> {
    if !present.contains("schema_version") {
        return None;
    }
    conn.query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
        row.get::<_, i64>(0)
    })
    .ok()
}

fn fingerprint_of(
    tables: &BTreeMap<String, BTreeSet<String>>,
    schema_version: Option<i64>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"session-store-capabilities-v1");
    for (table, columns) in tables {
        hasher.update(table.as_bytes());
        hasher.update(b"\x1f");
        for column in columns {
            hasher.update(column.as_bytes());
            hasher.update(b",");
        }
        hasher.update(b"\x1e");
    }
    if let Some(version) = schema_version {
        hasher.update(version.to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}
