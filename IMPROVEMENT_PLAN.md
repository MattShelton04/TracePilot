# TracePilot Error Handling Improvement Plan

## Problem Statement

The TracePilot codebase has inconsistent error handling patterns across its Rust crates:

1. **tracepilot-core** uses typed errors with `thiserror` - ✅ Good pattern
2. **tracepilot-orchestrator** uses string-based error variants - ❌ Loses context
3. **tracepilot-indexer** uses `anyhow::Result` - ❌ No type safety
4. **tracepilot-tauri-bindings** bridges the above with mixed approach

### Specific Issues

**Orchestrator (crates/tracepilot-orchestrator/src/error.rs):**
- Line 6: `Git(String)` - loses git command context, exit codes, stderr
- Line 14: `Config(String)` - no distinction between validation, parsing, or I/O errors
- Line 16: `Launch(String)` - combines validation, process spawn, and environment errors
- Line 18: `Version(String)` - version parsing vs. availability vs. compatibility
- Line 20: `Template(String)` - template validation vs. size limits vs. I/O
- Line 24: `Worktree(String)` - git failures vs. validation vs. filesystem issues
- Line 26: `Registry(String)` - database vs. validation vs. I/O errors

**Impact:**
- Error matching requires string parsing
- Lost error source chains
- No programmatic error handling in frontend
- Difficult debugging (stack traces hidden in strings)
- No error-specific recovery strategies

## Goals

1. **Type Safety**: Replace string-based error variants with typed errors
2. **Context Preservation**: Maintain error source chains and structured context
3. **User Experience**: Enable better error messages and recovery in the UI
4. **Developer Experience**: Make errors easier to debug and handle
5. **Consistency**: Align all crates on typed error patterns

## Solution Design

### Phase 1: Refactor Orchestrator Error Types

Transform string-based variants into structured enums with context:

```rust
// Before:
#[error("Git error: {0}")]
Git(String),

// After:
#[error("Git command failed: {command}")]
GitCommandFailed {
    command: String,
    exit_code: Option<i32>,
    stderr: String,
    #[source]
    source: Option<std::io::Error>,
},

#[error("Git validation failed: {message}")]
GitValidation { message: String },
```

### Phase 2: Add Indexer Error Types

Create `crates/tracepilot-indexer/src/error.rs` with typed errors:

```rust
#[derive(Debug, thiserror::Error)]
pub enum IndexerError {
    #[error("Database error: {context}")]
    Database {
        context: String,
        #[source]
        source: rusqlite::Error,
    },

    #[error("FTS5 search error: {query}")]
    SearchError {
        query: String,
        #[source]
        source: rusqlite::Error,
    },

    #[error("Migration error: version {version}")]
    Migration {
        version: u32,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    // ... more variants
}
```

### Phase 3: Update Error Propagation

Update all usage sites to construct typed errors:

```rust
// Before:
.map_err(|e| OrchestratorError::Git(e.to_string()))?

// After:
.map_err(|e| OrchestratorError::GitCommandFailed {
    command: "git worktree add".to_string(),
    exit_code: e.code(),
    stderr: String::from_utf8_lossy(&e.stderr()).to_string(),
    source: Some(e),
})?
```

### Phase 4: Update Tauri Bindings

Update `BindingsError` to handle new variants:

```rust
#[error(transparent)]
Indexer(#[from] tracepilot_indexer::IndexerError),  // typed now!
```

## Detailed Implementation Plan

### 1. Orchestrator Error Refactoring

**Files to Modify:**
- `crates/tracepilot-orchestrator/src/error.rs` (30 lines → ~150 lines)
- `crates/tracepilot-orchestrator/src/launcher.rs` (12 error sites)
- `crates/tracepilot-orchestrator/src/worktrees.rs` (4 error sites)
- `crates/tracepilot-orchestrator/src/config_injector.rs` (2+ error sites)
- `crates/tracepilot-orchestrator/src/version_manager.rs` (error sites)
- `crates/tracepilot-orchestrator/src/repo_registry.rs` (error sites)
- `crates/tracepilot-orchestrator/src/process.rs` (error sites)

**New Error Variants:**

```rust
pub enum OrchestratorError {
    // Git errors
    #[error("Git command failed: {command}")]
    GitCommandFailed {
        command: String,
        exit_code: Option<i32>,
        stderr: String,
        #[source]
        source: Option<std::io::Error>,
    },

    #[error("Git validation failed: {message}")]
    GitValidation { message: String },

    // Config errors
    #[error("Config file error: {path}")]
    ConfigFile {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Config validation failed: {field}")]
    ConfigValidation {
        field: String,
        message: String,
    },

    #[error("Invalid YAML in config: {path}")]
    ConfigYamlInvalid {
        path: String,
        #[source]
        source: serde_yml::Error,
    },

    // Launch errors
    #[error("Session launch failed: {reason}")]
    LaunchFailed {
        reason: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    #[error("Launch validation failed: {field}")]
    LaunchValidation {
        field: String,
        message: String,
    },

    #[error("CLI command not found: {command}")]
    CliCommandNotFound { command: String },

    #[error("Unknown model: {model}")]
    UnknownModel { model: String },

    // Worktree errors
    #[error("Worktree creation failed: {branch}")]
    WorktreeCreationFailed {
        branch: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("Invalid branch name: {name}")]
    InvalidBranchName {
        name: String,
        reason: String,
    },

    #[error("Worktree not found: {path}")]
    WorktreeNotFound { path: String },

    // Template errors
    #[error("Template exceeds size limit: {size} bytes (max {max_size})")]
    TemplateTooLarge {
        size: usize,
        max_size: usize,
    },

    #[error("Template not found: {id}")]
    TemplateNotFound { id: String },

    #[error("Template validation failed: {message}")]
    TemplateValidation { message: String },

    // Registry errors
    #[error("Repository not found: {path}")]
    RepositoryNotFound { path: String },

    #[error("Registry database error")]
    RegistryDatabase {
        #[source]
        source: rusqlite::Error,
    },

    // Version errors
    #[error("Copilot CLI not found")]
    CliNotFound,

    #[error("Unsupported Copilot version: {version}")]
    UnsupportedVersion {
        version: String,
        minimum: String,
    },

    // Keep existing simple variants
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yml::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Not found: {0}")]
    NotFound(String),
}
```

### 2. Indexer Error Creation

**New File:** `crates/tracepilot-indexer/src/error.rs`

```rust
//! Typed error types for tracepilot-indexer.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum IndexerError {
    #[error("Database error: {context}")]
    Database {
        context: String,
        #[source]
        source: rusqlite::Error,
    },

    #[error("FTS5 search failed: {query}")]
    SearchFailed {
        query: String,
        #[source]
        source: rusqlite::Error,
    },

    #[error("Session index corruption detected: {session_id}")]
    IndexCorruption {
        session_id: String,
        details: String,
    },

    #[error("Migration failed: version {from} → {to}")]
    MigrationFailed {
        from: u32,
        to: u32,
        #[source]
        source: rusqlite::Error,
    },

    #[error("Index writer error: {operation}")]
    WriterError {
        operation: String,
        #[source]
        source: rusqlite::Error,
    },

    #[error("Index reader error: {operation}")]
    ReaderError {
        operation: String,
        #[source]
        source: rusqlite::Error,
    },

    #[error("Content truncation: size {size} exceeds limit {limit}")]
    ContentTooLarge {
        size: usize,
        limit: usize,
        field: String,
    },

    #[error("Invalid session data: {reason}")]
    InvalidSessionData {
        reason: String,
        session_id: Option<String>,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, IndexerError>;
```

**Files to Update:**
- `crates/tracepilot-indexer/src/lib.rs` - add `pub mod error;` and replace `anyhow::Result`
- `crates/tracepilot-indexer/src/index_db/search_writer.rs` - replace anyhow
- `crates/tracepilot-indexer/src/index_db/search_reader.rs` - replace anyhow
- `crates/tracepilot-indexer/src/index_db/migrations.rs` - replace anyhow
- All other indexer modules

### 3. Migration Strategy

**Step 1: Create new error.rs files** ✅
- Add typed error enums with all variants

**Step 2: Add transitional constructors** ✅
- Add helper methods that construct typed errors from strings
- This allows incremental migration

```rust
impl OrchestratorError {
    pub fn git_failed(command: impl Into<String>, stderr: impl Into<String>) -> Self {
        Self::GitCommandFailed {
            command: command.into(),
            exit_code: None,
            stderr: stderr.into(),
            source: None,
        }
    }
}
```

**Step 3: Migrate usage sites one module at a time** ✅
- launcher.rs
- worktrees.rs
- config_injector.rs
- version_manager.rs
- repo_registry.rs
- process.rs

**Step 4: Update tauri-bindings** ✅
- Change `Indexer(#[from] anyhow::Error)` to `Indexer(#[from] tracepilot_indexer::IndexerError)`
- Test all Tauri commands

**Step 5: Remove transitional helpers** ✅
- Remove temporary constructor helpers
- Ensure all sites use typed construction

### 4. Testing Strategy

**Unit Tests:**
- Test error construction and Display formatting
- Test error source chains (`std::error::Error::source()`)
- Test error serialization for Tauri IPC

**Integration Tests:**
- Test error propagation through Tauri commands
- Test frontend error handling (error messages display correctly)
- Test error recovery scenarios

**Test Files to Create/Update:**
- `crates/tracepilot-orchestrator/src/error.rs` - add `#[cfg(test)] mod tests`
- `crates/tracepilot-indexer/src/error.rs` - add `#[cfg(test)] mod tests`
- `crates/tracepilot-tauri-bindings/src/error.rs` - update existing tests

### 5. Validation Steps

**Build Validation:**
```bash
# Must pass without errors
cargo check --workspace
cargo clippy --workspace -- -D warnings
cargo test --workspace --exclude tracepilot-bench
```

**Type Checking:**
```bash
# Must pass
pnpm typecheck
```

**Integration Testing:**
```bash
# Launch app and test error scenarios
pnpm tauri dev

# Test cases:
# 1. Launch session with invalid repo path
# 2. Create worktree with invalid branch name
# 3. Inject config with invalid YAML
# 4. Search with corrupted index
# 5. Open non-existent session
```

**Frontend Error Display:**
- Verify error messages are user-friendly
- Check error toast notifications
- Verify error logging to console
- Check error boundaries catch errors

## Benefits

### For Developers

1. **Type-Safe Error Handling**: Can match on specific error types
   ```rust
   match result {
       Err(OrchestratorError::UnknownModel { model }) => {
           // Suggest similar models
       }
       Err(OrchestratorError::GitCommandFailed { exit_code: Some(128), .. }) => {
           // Handle authentication issues
       }
       _ => {}
   }
   ```

2. **Better Error Messages**: Structured context included automatically
3. **Easier Debugging**: Full error source chains preserved
4. **Cleaner Code**: No more manual string formatting in error sites

### For Users

1. **Better Error Messages**: More specific and actionable errors
2. **Error Recovery**: Frontend can offer specific recovery actions
3. **Reduced Frustration**: Clear indication of what went wrong and why

### For Codebase Health

1. **Consistency**: All crates follow the same pattern
2. **Maintainability**: Adding new error cases is straightforward
3. **Documentation**: Error variants serve as API documentation
4. **Testing**: Easier to write tests for specific error conditions

## Risks and Mitigations

### Risk 1: Breaking Changes
**Mitigation**: Use `#[from]` conversions and transitional helpers to allow incremental migration

### Risk 2: Verbose Error Construction
**Mitigation**: Add convenience constructors for common cases

### Risk 3: Frontend Compatibility
**Mitigation**: Keep `Serialize` impl that converts to string; frontend changes optional

### Risk 4: Lost Context During Migration
**Mitigation**: Ensure each migration preserves at least as much context as before

## Success Criteria

✅ All orchestrator string-based errors replaced with typed variants
✅ Indexer has typed error enum instead of anyhow
✅ All Cargo tests pass
✅ All TypeScript tests pass
✅ App builds and launches successfully
✅ Error messages in UI remain user-friendly
✅ No regression in error handling behavior
✅ Code review by subagents approved

## Timeline Estimate

- Phase 1 (Orchestrator): ~150 lines of error.rs + ~60 error site updates
- Phase 2 (Indexer): ~120 lines of error.rs + ~40 error site updates
- Phase 3 (Propagation): Included in above
- Phase 4 (Bindings): ~10 line update
- Testing: Comprehensive validation

**Total Code Changes**: ~380 lines modified across ~15 files

## Implementation Order

1. ✅ Create new `OrchestratorError` variants in `error.rs`
2. ✅ Add transitional constructors
3. ✅ Update `launcher.rs` error sites (12 sites)
4. ✅ Update `worktrees.rs` error sites (4 sites)
5. ✅ Update `config_injector.rs` error sites
6. ✅ Update remaining orchestrator modules
7. ✅ Run orchestrator tests
8. ✅ Create `IndexerError` in new file
9. ✅ Update indexer modules
10. ✅ Run indexer tests
11. ✅ Update `BindingsError`
12. ✅ Full integration testing
13. ✅ Code review by subagents
14. ✅ Final validation

## Code Review Checklist

For each error migration:
- [ ] Error variant has descriptive name
- [ ] All relevant context fields included
- [ ] Source error chained where applicable
- [ ] Display message is user-friendly
- [ ] Error construction site preserves context
- [ ] Error is documented if non-obvious
- [ ] Test coverage for error case exists

## Future Enhancements

After this refactoring:

1. **Error Codes**: Add numeric error codes for frontend matching
   ```rust
   pub enum ErrorCode {
       E001_GitCommandFailed = 1001,
       E002_InvalidBranchName = 1002,
       // ...
   }
   ```

2. **Error Analytics**: Track error frequencies for monitoring
3. **User Actions**: Attach suggested recovery actions to errors
4. **Internationalization**: Prepare for localized error messages
5. **Structured Logging**: Log errors with structured context

---

**Plan Version**: 1.0
**Last Updated**: 2026-03-24
**Author**: Claude (TracePilot Improvement Initiative)
