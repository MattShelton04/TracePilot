//! Shared SQLite utility functions for consistent database operations across TracePilot.
//!
//! This module provides:
//! - Read-only connection opening with proper flags
//! - Schema inspection utilities (table_exists, column_exists)
//! - Safe SQL identifier handling with proper escaping
//!
//! # Stability Guarantees
//!
//! These utilities are considered **semi-stable**:
//! - Function signatures won't change in minor versions
//! - Error types may gain additional variants
//! - Performance characteristics are not guaranteed
//! - Internal implementation may change

mod connection;
mod placeholders;
mod profiler;
mod schema;

#[cfg(test)]
mod tests;

pub use connection::{configure_connection, open_readonly, open_readonly_if_exists};
pub use placeholders::{build_in_placeholders, build_placeholder_sql};
pub use schema::{column_exists, row_count, table_exists};
