# Implementation Plan 4: Testing Foundation (Workstream D)

**Priority**: Tier 2 — HIGH IMPORTANCE  
**Estimated Scope**: ~1000 lines of new test code  
**Dependencies**: D1 Step 2 requires C6. D2 requires H5 (package resolution). D1 benefits from A3 and F1.

---

## D1: Tauri IPC Bridge Tests

### Approach

`tracepilot-tauri-bindings` can't easily run full Tauri integration tests without a window/webview. Note: `lib.rs` is ~2,571 lines. Strategy:

1. **Extract pure logic** from `lib.rs` into testable helper functions (many already exist like `load_summary_list_item`, `read_config`)
2. **Test helpers directly** with mock filesystem/state
3. **Add contract tests** verifying command signatures match client expectations

### Step 1: Create test module

**File**: `crates/tracepilot-tauri-bindings/src/lib.rs` (bottom)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn read_config_returns_default_on_empty_state() {
        let state: SharedConfig = Arc::new(RwLock::new(None));
        let config = read_config(&state);
        assert_eq!(config.version, 2);
    }

    #[test]
    fn read_config_returns_stored_config() {
        let mut cfg = TracePilotConfig::default();
        cfg.general.auto_index_on_launch = true;
        let state: SharedConfig = Arc::new(RwLock::new(Some(cfg.clone())));
        let config = read_config(&state);
        assert!(config.general.auto_index_on_launch);
    }

    #[test]
    fn load_summary_handles_missing_file() {
        let result = load_summary_list_item(&PathBuf::from("/nonexistent/path"));
        assert!(result.is_err());
    }
}
```

> **Visibility note**: `load_summary_list_item` is **private** — defined inside `mod commands { ... }` in lib.rs and not `pub` at module boundary. Options:
> - **(a)** Add tests **inside** the `mod commands` block (recommended for now)
> - **(b)** Make the function `pub(crate)` and test from a sibling module
> - **(c)** Extract into a separate testable module (aligns with F1 — lib.rs split)
>
> Recommend option (a) for now; switch to (c) when F1 is done.

> **Dev dependency**: `tempfile` is not currently a dependency. Add to `crates/tracepilot-tauri-bindings/Cargo.toml`:
> ```toml
> [dev-dependencies]
> tempfile = "3"
> ```

### Step 2: Test config serialization round-trip

```rust
#[test]
fn config_round_trip_toml() {
    let config = TracePilotConfig::default();
    let toml_str = toml::to_string_pretty(&config).unwrap();
    let parsed: TracePilotConfig = toml::from_str(&toml_str).unwrap();
    assert_eq!(config.version, parsed.version);
    assert_eq!(config.features.render_markdown, parsed.features.render_markdown);
    // ⚠️ D1 Step 2 requires C6 (add renderMarkdown to Rust config).
    // The render_markdown assert above won't compile until C6 is implemented.
}

#[test]
fn config_deserializes_with_missing_fields() {
    // Simulates old config without new fields
    // Note: Config uses camelCase field names via #[serde(rename_all = "camelCase")]
    let toml_str = r#"
        version = 1
        [paths]
        sessionStateDir = "/tmp"
        indexDbPath = "/tmp/index.db"
    "#;
    let config: TracePilotConfig = toml::from_str(toml_str).unwrap();
    assert!(config.features.render_markdown); // default true
}
```

### Step 3: Contract tests (command name parity)

Create `crates/tracepilot-tauri-bindings/tests/contract.rs`:
```rust
//! Verifies that every command name the frontend expects actually exists.
//!
//! Pragmatic approach (no macro introspection needed):
//! 1. Use `include_str!` to load lib.rs source at compile time
//! 2. Extract `#[tauri::command]` fn names via simple string matching
//! 3. Compare against expected command names from the client package
//!
//! Alternative (CI-friendly): generate a JSON manifest of command names
//! in a build script, check it in, and verify it in CI.

/// Extract function names following `#[tauri::command]` annotations.
fn extract_tauri_commands(source: &str) -> Vec<String> {
    let mut commands = Vec::new();
    let mut next_is_command = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.contains("#[tauri::command") {
            next_is_command = true;
            continue;
        }
        if next_is_command {
            if let Some(fn_start) = trimmed.strip_prefix("pub async fn ")
                .or_else(|| trimmed.strip_prefix("async fn "))
                .or_else(|| trimmed.strip_prefix("pub fn "))
                .or_else(|| trimmed.strip_prefix("fn "))
            {
                if let Some(name) = fn_start.split('(').next() {
                    commands.push(name.trim().to_string());
                }
            }
            next_is_command = false;
        }
    }
    commands
}

/// Known commands the frontend invokes (from client/src/index.ts).
/// Keep this list in sync — CI will catch drift.
const EXPECTED_COMMANDS: &[&str] = &[
    "get_sessions",
    "get_session_detail",
    "get_session_turns",
    "get_config",
    "save_config",
    "search_content",
    "get_search_facets",
    "get_session_analytics",
    "get_typed_events",
    // ... add remaining commands from @tracepilot/client invoke() calls
];

#[test]
fn all_expected_commands_exist_in_rust() {
    let source = include_str!("../src/lib.rs");
    let rust_commands = extract_tauri_commands(source);
    for expected in EXPECTED_COMMANDS {
        assert!(
            rust_commands.iter().any(|c| c == expected),
            "Frontend expects command '{}' but it was not found in lib.rs. \
             Rust commands found: {:?}",
            expected,
            rust_commands
        );
    }
}
```

> **Maintenance**: To keep `EXPECTED_COMMANDS` in sync, you can also grep `client/src/index.ts` for `invoke('...')` patterns in a CI script and compare against the manifest.

### Priority Commands to Test (top 10 by usage)
1. `get_sessions` / `get_session_detail` / `get_session_turns`
2. `get_config` / `save_config`
3. `search_content` / `get_search_facets`
4. `get_session_analytics`
5. `get_typed_events`

### Acceptance Criteria
- At least 15 tests in tauri-bindings crate
- `cargo test -p tracepilot-tauri-bindings` passes
- Config serialization round-trip verified

---

## D2: CLI Test Suite

### Approach

The CLI is a pure TypeScript application (`apps/cli/`). Add Vitest tests.

> **⚠️ Blocker**: CLI runtime packaging is currently broken — `@tracepilot/types` resolves to TS source with missing compiled `.js` siblings. CLI build must be fixed (H5) before CLI tests can reliably run in all contexts. **D2 depends on H5.**

### Step 1: Add test infrastructure

**File**: `apps/cli/package.json` — add:
```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

**File**: `apps/cli/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

### Step 2: Test argument validation

**File**: `apps/cli/src/__tests__/commands.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('list command', () => {
  it('rejects negative --limit', () => { ... });
  it('applies --sort correctly', () => { ... });
  it('handles empty session directory', () => { ... });
});

describe('search command', () => {
  it('rejects empty query', () => { ... });
  it('searches user messages by default', () => { ... });
});

describe('versions command', () => {
  it('returns non-zero exit for invalid version', () => { ... });
  it('diff shows changes between versions', () => { ... });
});
```

### Step 3: Test version-analyzer pure functions

The version-analyzer has complex logic (~600 lines). Extract and test pure functions:
- `parseAgentYaml()`
- `computeCoverage()`
- `diffVersions()`

### Acceptance Criteria
- `pnpm --filter @tracepilot/cli test` runs and passes
- At least 10 tests covering argument validation and core logic
- `pnpm -r test` now includes CLI (no silent skip)

---

## D3: Client Package Tests

### Approach

**File**: `packages/client/src/__tests__/client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

describe('@tracepilot/client', () => {
  describe('mock fallback', () => {
    it('returns mock sessions when not in Tauri', async () => {
      // Verify the non-Tauri path returns mock data
      const { getSessions } = await import('../index.js');
      const sessions = await getSessions('/fake/path');
      expect(sessions).toBeDefined();
      expect(Array.isArray(sessions)).toBe(true);
    });
  });

  describe('IPC command names', () => {
    it('invoke names match expected contract', () => {
      // Verify command names don't drift
      // Parse source for invoke('command_name', ...) patterns
    });
  });

  describe('type contracts', () => {
    it('mock data matches expected types', () => {
      // Verify MOCK_SESSIONS satisfies SessionListItem[]
      // Verify MOCK_ANALYTICS satisfies SessionAnalytics
    });
  });
});
```

### Acceptance Criteria
- At least 5 tests verifying mock fallback and type contracts
- `pnpm --filter @tracepilot/client test` passes

---

## D4: Coverage Configuration

### Step 1: Install coverage tool

```bash
pnpm add -D @vitest/coverage-v8 --filter @tracepilot/desktop --filter @tracepilot/ui
```

### Step 2: Configure

**File**: `apps/desktop/vitest.config.ts`:
```ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
```

Same for `packages/ui/vitest.config.ts`.

### Step 3: Add coverage script

**File**: Root `package.json`:
```json
"scripts": {
  "test:coverage": "pnpm -r run test -- --coverage"
}
```

### Acceptance Criteria
- `pnpm test:coverage` produces an lcov report
- Coverage numbers are visible in CI output

---

## D5: Fix CLI Argument Validation Bugs

### `--sort` ignored

**File**: `apps/cli/src/commands/list.ts`

Find where sessions are returned and apply sort logic based on the `--sort` flag. Currently the flag is parsed but never used in the session processing pipeline.

### `--limit` accepts negatives

```ts
// Add validation after parsing:
if (options.limit !== undefined && options.limit < 1) {
  console.error('Error: --limit must be a positive integer');
  process.exit(1);
}
```

### Empty search query

```ts
// In search command:
if (!query || query.trim() === '') {
  console.error('Error: search query cannot be empty');
  process.exit(1);
}
```

### Acceptance Criteria
- `tracepilot list --sort newest` actually sorts by newest
- `tracepilot list --limit -5` exits with error
- `tracepilot search ""` exits with error

---

## Review Notes

*Corrections applied from 4-model review:*

1. **D1 Step 1**: Fixed field name `auto_index` → `auto_index_on_launch` (config field, assert).
2. **D1 Step 1**: Added visibility note — `load_summary_list_item` is private (inside `mod commands`). Documented three options; recommend (a) now, (c) after F1.
3. **D1 Step 1**: Added `tempfile = "3"` to `[dev-dependencies]` — was missing.
4. **D1 Step 2**: Added dependency note — `render_markdown` assert requires C6 (field doesn't exist in Rust yet).
5. **D1 Step 2**: Fixed TOML field names from snake_case to camelCase (`sessionStateDir`, `indexDbPath`) to match `#[serde(rename_all = "camelCase")]`.
6. **D1 Step 3**: Replaced empty/aspirational contract test with working `include_str!` + regex approach and concrete `extract_tauri_commands` implementation.
7. **D2**: Added blocker note — CLI packaging broken (`@tracepilot/types` resolves to TS source, missing `.js`). D2 depends on H5.
8. **Header**: Updated dependency line to reflect C6, H5, A3, and F1 relationships.
9. **D1 Approach**: Noted lib.rs is ~2,571 lines.
