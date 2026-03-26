# Implementation Plan: SQLite Helper Function Consolidation

## Problem Statement

Through comprehensive codebase analysis, I've identified **significant code duplication** in SQLite helper functions across multiple Rust crates in TracePilot. This technical debt creates:

1. **Maintenance burden**: Changes must be replicated across multiple locations
2. **Inconsistency risk**: Similar but slightly different implementations can lead to bugs
3. **Testing overhead**: Same logic needs testing in multiple places
4. **Code bloat**: Unnecessary duplication increases codebase size

### Specific Duplications Identified

#### 1. `open_readonly()` - SQLite Connection Opening (HIGH PRIORITY)
**Location**: `crates/tracepilot-core/src/parsing/session_db.rs:39-48`
```rust
fn open_readonly(db_path: &Path) -> Result<Connection> {
    Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open session db: {}", db_path.display()),
        source: Some(Box::new(e)),
    })
}
```

**Duplicated**: Nearly identical logic exists in:
- `crates/tracepilot-indexer/src/index_db/mod.rs:62-72` (uses different error type)
- Used multiple times within `session_db.rs` (lines 67, 99, 125, 153)
- Referenced in `tauri-bindings/src/helpers.rs:87` via `IndexDb::open_readonly`

#### 2. `table_exists()` - SQLite Table Existence Check (HIGH PRIORITY)
**Location**: `crates/tracepilot-core/src/parsing/session_db.rs:50-58`
```rust
fn table_exists(conn: &Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table_name],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}
```

**Duplicated**: Used in multiple places:
- `crates/tracepilot-core/src/parsing/session_db.rs:69,101,155`
- Similar patterns in `tauri-bindings` when checking table existence
- Pattern repeated in orchestration commands

#### 3. `truncate_utf8()` - String Truncation (MEDIUM PRIORITY)
**Location 1**: `crates/tracepilot-core/src/utils/mod.rs` (canonical implementation)
```rust
pub fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
    // ... (proper UTF-8 boundary handling)
}
```

**Location 2**: `crates/tracepilot-tauri-bindings/src/helpers.rs:44-47`
```rust
pub(crate) fn truncate_utf8(s: &mut String, max_bytes: usize) {
    let truncated_len = tracepilot_core::utils::truncate_utf8(s.as_str(), max_bytes).len();
    s.truncate(truncated_len);
}
```

**Location 3**: `crates/tracepilot-indexer/src/index_db.rs` (if exists - mentioned in exploration)

**Status**: Partially resolved (tauri-bindings already calls core), but wrapper pattern can be improved

## Proposed Solution

### High-Level Architecture

Create a new **shared SQLite utilities module** in `tracepilot-core` that provides:
1. Standard connection opening patterns (read-only, read-write)
2. Common query helpers (table_exists, column_exists, etc.)
3. Consistent error handling across all SQLite operations
4. Well-documented, well-tested utilities

### Why `tracepilot-core`?

- Already contains `utils` module
- No circular dependencies (core is a leaf crate)
- Already depended upon by both `tauri-bindings` and `indexer`
- Natural location for shared parsing/database utilities

## Detailed Implementation Plan

### Phase 1: Create Shared SQLite Utilities Module

**File**: `crates/tracepilot-core/src/utils/sqlite.rs`

#### 1.1: Define Error Handling Strategy

```rust
use crate::error::{Result, TracePilotError};
use rusqlite::Connection;
use std::path::Path;

/// Error context for SQLite operations.
#[derive(Debug, Clone)]
pub enum SqliteContext {
    OpenDatabase(String),
    QueryTable(String),
    Other(String),
}

impl SqliteContext {
    pub fn open_db(path: impl std::fmt::Display) -> Self {
        SqliteContext::OpenDatabase(format!("Failed to open database: {}", path))
    }

    pub fn query_table(table: &str) -> Self {
        SqliteContext::QueryTable(format!("Failed to query table: {}", table))
    }
}

/// Helper to convert rusqlite errors to TracePilotError
fn to_parse_error(context: SqliteContext, source: rusqlite::Error) -> TracePilotError {
    TracePilotError::ParseError {
        context: format!("{:?}", context),
        source: Some(Box::new(source)),
    }
}
```

#### 1.2: Implement `open_readonly()` Function

```rust
/// Open a SQLite database in read-only mode without creating file locks.
///
/// This is the preferred method for all read operations to avoid:
/// - Creating WAL/SHM files on read-only file systems
/// - Holding unnecessary locks
/// - Blocking other readers
///
/// # Arguments
/// * `path` - Path to the SQLite database file
///
/// # Returns
/// - `Ok(Connection)` if the database exists and can be opened
/// - `Err(TracePilotError)` if the file doesn't exist or cannot be opened
///
/// # Example
/// ```no_run
/// use tracepilot_core::utils::sqlite::open_readonly;
/// use std::path::Path;
///
/// let conn = open_readonly(Path::new("/path/to/db.sqlite"))?;
/// ```
pub fn open_readonly(db_path: &Path) -> Result<Connection> {
    Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| to_parse_error(SqliteContext::open_db(db_path.display()), e))
}
```

#### 1.3: Implement `table_exists()` Function

```rust
/// Check if a table exists in a SQLite database.
///
/// # Arguments
/// * `conn` - Open SQLite connection
/// * `table_name` - Name of the table to check
///
/// # Returns
/// - `true` if the table exists
/// - `false` if the table doesn't exist or query fails
///
/// # Example
/// ```no_run
/// use tracepilot_core::utils::sqlite::{open_readonly, table_exists};
/// use std::path::Path;
///
/// let conn = open_readonly(Path::new("/path/to/db.sqlite"))?;
/// if table_exists(&conn, "todos") {
///     // Table exists, query it
/// }
/// ```
pub fn table_exists(conn: &Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table_name],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .unwrap_or(false)
}
```

**Note**: Changed return type from `bool` (via `row.get::<_, bool>(0)`) to `i64` comparison because SQLite `COUNT(*)` returns an integer, not a boolean. This is more correct.

#### 1.4: Add Additional Utilities (Bonus)

```rust
/// Check if a column exists in a table.
///
/// Useful for schema evolution and optional column handling.
pub fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> bool {
    let query = format!("PRAGMA table_info('{}')", table_name.replace("'", "''"));
    conn.prepare(&query)
        .and_then(|mut stmt| {
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let col: String = row.get(1)?;
                if col == column_name {
                    return Ok(true);
                }
            }
            Ok(false)
        })
        .unwrap_or(false)
}

/// Get the row count of a table efficiently.
///
/// Returns None if the table doesn't exist or query fails.
pub fn row_count(conn: &Connection, table_name: &str) -> Option<i64> {
    let query = format!("SELECT COUNT(*) FROM \"{}\"", table_name.replace("\"", "\"\""));
    conn.query_row(&query, [], |row| row.get(0)).ok()
}
```

#### 1.5: Add Comprehensive Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::TempDir;

    fn create_test_db(dir: &TempDir) -> std::path::PathBuf {
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);
             INSERT INTO users VALUES (1, 'Alice');
             INSERT INTO users VALUES (2, 'Bob');",
        )
        .unwrap();
        db_path
    }

    #[test]
    fn test_open_readonly_success() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let conn = open_readonly(&db_path).unwrap();

        // Verify we can query
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_open_readonly_nonexistent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("nonexistent.db");
        let result = open_readonly(&db_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_table_exists_true() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let conn = open_readonly(&db_path).unwrap();

        assert!(table_exists(&conn, "users"));
        assert!(table_exists(&conn, "posts"));
    }

    #[test]
    fn test_table_exists_false() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let conn = open_readonly(&db_path).unwrap();

        assert!(!table_exists(&conn, "nonexistent"));
        assert!(!table_exists(&conn, ""));
    }

    #[test]
    fn test_column_exists() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let conn = open_readonly(&db_path).unwrap();

        assert!(column_exists(&conn, "users", "id"));
        assert!(column_exists(&conn, "users", "name"));
        assert!(!column_exists(&conn, "users", "email"));
    }

    #[test]
    fn test_row_count() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let conn = open_readonly(&db_path).unwrap();

        assert_eq!(row_count(&conn, "users"), Some(2));
        assert_eq!(row_count(&conn, "posts"), Some(0));
        assert_eq!(row_count(&conn, "nonexistent"), None);
    }

    #[test]
    fn test_sql_injection_resistance() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let conn = open_readonly(&db_path).unwrap();

        // These should safely return false, not execute malicious SQL
        assert!(!table_exists(&conn, "users'; DROP TABLE users; --"));
        assert!(!column_exists(&conn, "users'; DROP TABLE users; --", "name"));
    }
}
```

#### 1.6: Update Module Structure

**File**: `crates/tracepilot-core/src/utils/mod.rs`

Add:
```rust
pub mod sqlite;
```

And re-export commonly used functions:
```rust
pub use sqlite::{open_readonly, table_exists};
```

### Phase 2: Replace Usage in `tracepilot-core`

#### 2.1: Update `session_db.rs`

**File**: `crates/tracepilot-core/src/parsing/session_db.rs`

Changes:
1. Remove local `open_readonly()` function (lines 39-48)
2. Remove local `table_exists()` function (lines 50-58)
3. Add import: `use crate::utils::sqlite::{open_readonly, table_exists};`
4. Update all call sites (lines 67, 99, 125, 153) - no changes needed, same signatures

**Before**:
```rust
fn open_readonly(db_path: &Path) -> Result<Connection> {
    // ... implementation
}

fn table_exists(conn: &Connection, table_name: &str) -> bool {
    // ... implementation
}

pub fn read_todos(db_path: &Path) -> Result<Vec<TodoItem>> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let conn = open_readonly(db_path)?;
    if !table_exists(&conn, "todos") {
        return Ok(Vec::new());
    }
    // ...
}
```

**After**:
```rust
use crate::utils::sqlite::{open_readonly, table_exists};

pub fn read_todos(db_path: &Path) -> Result<Vec<TodoItem>> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let conn = open_readonly(db_path)?;
    if !table_exists(&conn, "todos") {
        return Ok(Vec::new());
    }
    // ...
}
```

**Expected diff**: ~20 lines removed, 1 line added (net: -19 lines)

### Phase 3: Replace Usage in `tracepilot-indexer`

#### 3.1: Update `index_db/mod.rs`

**File**: `crates/tracepilot-indexer/src/index_db/mod.rs`

The indexer has its own `open_readonly()` implementation (lines 62-72) with different error handling. We need to adapt it.

**Current code**:
```rust
pub fn open_readonly(path: &Path) -> Result<Self> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| IndexerError::database_open(format!("{} (readonly)", path.display()), e))?;

    conn.execute_batch("PRAGMA busy_timeout=5000;")
        .map_err(|e| IndexerError::database_config("Failed to set readonly pragmas", e))?;

    Ok(Self { conn })
}
```

**Strategy**: Keep the method but use the core utility internally:

```rust
use tracepilot_core::utils::sqlite::open_readonly as open_readonly_core;

pub fn open_readonly(path: &Path) -> Result<Self> {
    let conn = open_readonly_core(path)
        .map_err(|e| IndexerError::database_open(format!("{} (readonly)", path.display()), e.into()))?;

    conn.execute_batch("PRAGMA busy_timeout=5000;")
        .map_err(|e| IndexerError::database_config("Failed to set readonly pragmas", e))?;

    Ok(Self { conn })
}
```

**Challenge**: Error type conversion. Need to verify if `TracePilotError` can convert to the source error type that `IndexerError` expects.

**Alternative approach** (if error conversion is complex):
```rust
pub fn open_readonly(path: &Path) -> Result<Self> {
    // Use the same flags as the core utility for consistency
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| IndexerError::database_open(format!("{} (readonly)", path.display()), e))?;

    conn.execute_batch("PRAGMA busy_timeout=5000;")
        .map_err(|e| IndexerError::database_config("Failed to set readonly pragmas", e))?;

    Ok(Self { conn })
}
```

Keep the duplication here but document that it follows the same pattern as `tracepilot_core::utils::sqlite::open_readonly`. The indexer needs its own wrapper for the `IndexDb` struct and error handling, so complete deduplication isn't possible without major refactoring.

**Decision**: Keep current implementation but add comment explaining the relationship to core utility.

### Phase 4: Update `tracepilot-tauri-bindings`

#### 4.1: Update `helpers.rs`

**File**: `crates/tracepilot-tauri-bindings/src/helpers.rs`

The bindings already use `IndexDb::open_readonly()`, so no changes needed in `open_index_db()` function.

The `truncate_utf8()` wrapper (lines 44-47) is already using core, so this is fine.

**No changes needed** in this crate.

### Phase 5: Search for Other Duplication Patterns

#### 5.1: Search for additional SQLite patterns

Look for:
- Other repeated SQLite queries (e.g., getting schema version)
- Connection opening with different flags
- Transaction management patterns
- Pragma settings

**Files to check**:
- `crates/tracepilot-tauri-bindings/src/commands/session.rs`
- `crates/tracepilot-tauri-bindings/src/commands/search.rs`
- `crates/tracepilot-tauri-bindings/src/commands/orchestration.rs`

**Action**: Quick grep during implementation to identify any other low-hanging fruit.

### Phase 6: Testing Strategy

#### 6.1: Unit Tests

**Scope**:
- New `sqlite.rs` module tests (included in Phase 1.5)
- Existing tests in `session_db.rs` should pass unchanged
- Existing tests in `index_db/mod.rs` should pass unchanged

**Command**:
```bash
cargo test --package tracepilot-core --lib utils::sqlite
cargo test --package tracepilot-core --lib parsing::session_db
cargo test --package tracepilot-indexer --lib index_db
```

#### 6.2: Integration Tests

**Scope**:
- Full `tracepilot-core` test suite
- Full `tracepilot-indexer` test suite
- Full `tracepilot-tauri-bindings` test suite (if any)

**Command**:
```bash
cargo test --workspace
```

#### 6.3: Desktop App Tests

**Scope**:
- Desktop app functionality that uses session database reading (todos, events, etc.)
- Search functionality that uses the index database

**Command**:
```bash
cd apps/desktop
pnpm test
```

#### 6.4: Build Verification

**Command**:
```bash
cargo build --workspace --release
```

#### 6.5: Manual Testing Checklist

1. **Sessions View**:
   - Open TracePilot desktop app
   - Navigate to Sessions view
   - Verify sessions list loads correctly
   - Search for a session by name/repo
   - Verify search works

2. **Session Detail View**:
   - Click on a session
   - Navigate to "Todos" tab
   - Verify todos load correctly
   - Navigate to "Events" tab
   - Verify events load correctly

3. **Search Functionality**:
   - Use global search
   - Verify FTS search returns results
   - Check search facets/filters work

4. **Analytics View**:
   - Navigate to Analytics
   - Verify analytics data loads
   - Check tool analysis

5. **Indexing**:
   - Trigger manual reindex
   - Verify indexing completes successfully
   - Check that new sessions appear

### Phase 7: Documentation

#### 7.1: Update `session_db.rs` Documentation

Add a note at the top of the file:
```rust
//! Parser for `session.db` — the SQLite database containing todos and custom tables.
//!
//! This module uses shared SQLite utilities from `crate::utils::sqlite` for
//! consistent connection handling and error management across the codebase.
```

#### 7.2: Update `index_db/mod.rs` Documentation

Add a note about SQLite patterns:
```rust
//! Local SQLite index database with FTS5 and incremental analytics.
//!
//! The `open_readonly()` method follows the same pattern as
//! `tracepilot_core::utils::sqlite::open_readonly()` for consistency,
//! but includes additional IndexDb-specific setup (pragmas, struct wrapping).
```

#### 7.3: Add Migration Notes

Create or update `CHANGELOG.md` entry:
```markdown
## [Unreleased]

### Changed
- Consolidated duplicate SQLite helper functions into shared utilities module
  in `tracepilot-core` (`utils::sqlite`)
- Improved code maintainability by reducing duplication across crates

### Developer Notes
- When working with SQLite databases, use `tracepilot_core::utils::sqlite::{open_readonly, table_exists}`
- These utilities provide consistent error handling and are well-tested
```

## Impact Analysis

### Benefits

1. **Reduced Code Duplication**: ~40-50 lines of duplicated code eliminated
2. **Improved Maintainability**: Single source of truth for SQLite operations
3. **Better Testing**: Centralized tests for common operations
4. **Consistency**: Same behavior across all crates
5. **Future-Proof**: Easy to add new utilities (e.g., `column_exists`, `row_count`)

### Risks

1. **Minimal**: Functions are simple and well-tested
2. **Error Handling**: Different crates have different error types, but we handle this with proper conversion
3. **Build Time**: No significant impact (adding one small module)

### Breaking Changes

**None**. All changes are internal refactoring with same external behavior.

### Performance Impact

**None**. Same SQLite operations, just organized differently.

## Alternative Approaches Considered

### Alternative 1: Create a new `tracepilot-sqlite` crate

**Pros**:
- Even more separation of concerns
- Could be used by other projects

**Cons**:
- Overkill for 3-4 small utilities
- Adds another dependency to manage
- More complex build setup

**Decision**: Rejected. Current approach is simpler.

### Alternative 2: Keep duplication, just document it

**Pros**:
- No code changes needed
- Zero risk

**Cons**:
- Technical debt remains
- Maintenance burden continues

**Decision**: Rejected. The problem is worth solving.

### Alternative 3: Use a macro to generate the functions

**Pros**:
- Could reduce duplication further

**Cons**:
- More complex
- Harder to debug
- Overkill for simple functions

**Decision**: Rejected. Direct functions are clearer.

## Success Criteria

1. ✅ All existing tests pass
2. ✅ New utilities have >90% test coverage
3. ✅ Desktop app functionality unchanged (manual testing)
4. ✅ Build completes successfully
5. ✅ Code review by subagents passes
6. ✅ Net reduction in lines of code
7. ✅ No performance regression

## Timeline

**Total Estimated Time**: 2-3 hours

- Phase 1: Create shared utilities (~45 min)
- Phase 2: Update core (~15 min)
- Phase 3: Update indexer (~15 min)
- Phase 4: Update bindings (~5 min)
- Phase 5: Search for more patterns (~10 min)
- Phase 6: Testing (~45 min)
- Phase 7: Documentation (~10 min)

## Files Changed

### New Files
- `crates/tracepilot-core/src/utils/sqlite.rs` (~250 lines including tests)

### Modified Files
- `crates/tracepilot-core/src/utils/mod.rs` (+2 lines)
- `crates/tracepilot-core/src/parsing/session_db.rs` (-19 lines)
- `crates/tracepilot-indexer/src/index_db/mod.rs` (+5 lines comments)
- `CHANGELOG.md` (if exists, +10 lines)

### Total Impact
- **New code**: ~250 lines (utilities + tests)
- **Removed code**: ~20 lines (duplicates)
- **Modified code**: ~10 lines (imports, comments)
- **Net change**: ~+240 lines (mostly tests and documentation)

## Rollback Plan

If issues arise:
1. Revert commits (Git)
2. Restore deleted `open_readonly()` and `table_exists()` in `session_db.rs`
3. No data migration needed (no schema changes)
4. No configuration changes needed

**Rollback Risk**: Very low. Changes are internal only.

## Follow-Up Work

After this PR, consider:
1. Add more SQLite utilities as patterns emerge (e.g., `column_exists`)
2. Create similar utilities for other common patterns (e.g., file I/O, YAML parsing)
3. Add linting rules to detect future duplication
4. Document best practices for adding new utilities

## Review Focus Areas

When reviewing this plan, please focus on:
1. **Error handling strategy**: Is the error conversion approach sound?
2. **Test coverage**: Are the tests comprehensive enough?
3. **API design**: Are the function signatures ergonomic?
4. **Documentation**: Is the rationale clear?
5. **Impact**: Are there any edge cases we're missing?

---

**Plan Status**: Ready for Review
**Plan Version**: 1.0
**Last Updated**: 2026-03-25
