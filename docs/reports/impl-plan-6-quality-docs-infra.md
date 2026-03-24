# Implementation Plan 6: Code Quality, Docs, Infra & Polish (Workstreams F, G, H, I)

**Priority**: Tier 3-4 — MEDIUM/LOW  
**Dependencies**: Some items benefit from earlier workstreams but none are blocked  

---

## Workstream F: Code Quality Cleanup

### F1: Split `tauri-bindings/lib.rs` into Modules

**Current**: 2,571 lines, 78 commands in one file.

> **Critical context**: `lib.rs` already contains an **inline `mod commands { ... }`** block starting at line 196. The migration path is NOT "create a new `commands/` directory from scratch" — it is:
> 1. Convert the existing inline `mod commands { ... }` to a filesystem module (`commands/mod.rs`)
> 2. Then split `commands/mod.rs` into sub-modules
>
> Commands are registered via `generate_handler!` as `commands::list_sessions`, `commands::get_session_detail`, etc. (lib.rs:2488+). When splitting into sub-modules, use `pub use` re-exports from `commands/mod.rs` to keep the registration code unchanged.

**Proposed structure**:
```
crates/tracepilot-tauri-bindings/src/
├── lib.rs              # Plugin init, re-exports, shared types (~100 lines)
├── error.rs            # BindingsError (from A3)
├── config.rs           # Already exists — config types
├── commands/
│   ├── mod.rs          # Re-export all command modules
│   ├── sessions.rs     # Session list, detail, turns, events (~400 lines)
│   ├── search.rs       # Search, facets, indexing (~300 lines)
│   ├── analytics.rs    # Analytics, code impact, tool analysis (~200 lines)
│   ├── config_cmd.rs   # get/save/reset config (~150 lines)
│   ├── orchestration.rs # Launcher, worktrees, config injector (~500 lines)
│   └── utility.rs      # Version check, logging, filesystem (~300 lines)
```

**`commands/mod.rs` re-export pattern** (keeps `generate_handler!` registrations unchanged):
```rust
// commands/mod.rs
mod sessions;
mod search;
mod analytics;
mod config_cmd;
mod orchestration;
mod utility;

pub use sessions::*;
pub use search::*;
pub use analytics::*;
pub use config_cmd::*;
pub use orchestration::*;
pub use utility::*;
```

**Approach**:
1. Extract inline `mod commands { ... }` block into `commands/mod.rs`
2. Split `commands/mod.rs` one sub-module at a time (start with utility — least coupled)
3. Add `pub use` re-exports in `commands/mod.rs` so `generate_handler!` registrations remain valid
4. Run `cargo test` + `cargo clippy` after each module extraction

> **Build.rs sync**: `apps/desktop/src-tauri/build.rs` contains a command allowlist that must stay in sync with the module structure. Any split must also update `build.rs`.

### ~~F2: Extract Duplicated Agent Color Maps~~ — **Already complete.**

All three components (`AgentTreeView.vue`, `NestedSwimlanesView.vue`, `TurnWaterfallView.vue`) already import the shared `AGENT_COLORS` from `@tracepilot/ui/utils/agentTypes`:
```ts
// packages/ui/src/utils/agentTypes.ts:17-23
export const AGENT_COLORS: Record<AgentType, string> = { ... };
```
No action required.

### F3: Replace Hardcoded Colors with CSS Variables (67+ instances)

**Approach**: 
1. Audit all hardcoded hex values: `grep -rn '#[0-9a-fA-F]\{3,8\}' apps/desktop/src/`
2. Map each to the closest existing CSS variable from the design system
3. Replace in batches by file
4. Test light and dark themes after each batch

**High-priority** (breaking light theme):
- `ToolAnalysisView.vue:502` — `rgba(255, 255, 255, 0.85)` → `var(--bg-primary)`
- Chart views using white text/backgrounds

### F4: Consolidate Inline Styles (130+ instances)

This is the largest cleanup task. Approach:
1. Categorize: dynamic styles (must stay inline) vs static (should be classes)
2. For static styles, create scoped CSS classes in each component
3. For dynamic styles, use CSS custom properties where possible
4. Target: reduce inline styles by 70%+

> **Risk mitigation**: Add visual regression tests (Playwright screenshots) before this work.

### F5: Remove Dead Code

| Item | Action |
|------|--------|
| `ThemeToggle.vue` | Delete file (AppSidebar has own toggle) |
| `EditDiffRenderer` lines 40-99 | Remove word-level highlight computed + unused `oldLineCount`/`newLineCount` |
| `Badge.vue` `useSlots` import | Verify before removing — `useSlots` IS called (`const slots = useSlots();`); the variable may be used in the template via `$slots`. Check template before removing. |
| `search.ts:7` unused `readFile` | Remove import |
| `versions.ts:17` unused type | Remove import |

### F6: Fix WebSearchRenderer Privacy Leak

**File**: `packages/ui/src/components/renderers/WebSearchRenderer.vue:121-123`

```ts
// BEFORE
`https://www.google.com/s2/favicons?domain=${domain}`

// AFTER — use a generic globe icon or bundled favicons
// Option A: Remove favicons entirely, use a generic icon
// Option B: Use DuckDuckGo's service (more privacy-friendly)
// Option C: Bundle a small set of common favicons
```

**Recommendation**: Option A (simplest) — use a `🌐` emoji or SVG globe icon.

### F7: Fix ToolDetailPanel/ToolCallDetail Default Disagreement

```ts
// ToolDetailPanel.vue — change to match ToolCallDetail:
const richEnabled = computed(() => props.richRendering !== false);  // default true

// OR ToolCallDetail.vue — change to match ToolDetailPanel:
const richEnabled = computed(() => props.richRendering ?? false);   // default false
```

**Recommendation**: Default to `true` (rich rendering is the better UX).

---

## Workstream G: Documentation

### G1: Update Stale Docs

| File | Change |
|------|--------|
| `docs/tech-debt-report.md:580-585` | Update CI/CD section to reflect that CI exists |
| `docs/tech-debt-report.md:572` | Remove claim about `apps/cli/dist/` being tracked |
| `docs/tech-debt-report.md:625` | Remove claim about no LICENSE file |
| `docs/versioning-updates-release-strategy.md:59-70` | Update to reflect CHANGELOG and workflows exist |
| `apps/cli/README.md` | Update `search` from "coming soon" to documented, add `resume`/`index`/`versions` docs |

### G2: Fix Broken Links

**File**: `docs/copilot-sdk-deep-dive.md:1559-1562`

Either create the referenced review files or remove the links.

### G3: Create CONTRIBUTING.md and SECURITY.md

**CONTRIBUTING.md** should cover:
- Development setup (pnpm install, cargo build)
- Running tests (pnpm test, cargo test)
- Code style (Biome for TS, clippy for Rust)
- PR process
- Commit conventions (conventional commits, lefthook)

**SECURITY.md** should cover:
- Reporting vulnerabilities
- Security response process
- Supported versions

### G4: Add README Screenshots

Take screenshots of:
1. Session list view
2. Session detail / conversation view
3. Analytics dashboard
4. Session timeline
5. Orchestration home

Replace `<!-- SCREENSHOT: ... -->` placeholders.

### G5: Add Rust Doc Comments

Priority order:
1. `tracepilot-tauri-bindings` — all `#[tauri::command]` functions
2. `tracepilot-core/models/` — all public structs/enums
3. `tracepilot-core/turns/` — `ConversationTurn` fields
4. `tracepilot-orchestrator/types.rs` — all public types

### G6: Create Docs Index

**File**: `docs/README.md`

```markdown
# TracePilot Documentation

## Current
- [Implementation Phases](implementation-phases.md) — Feature roadmap and status
- [Architecture](architecture-decisions.md) — System design decisions
- [Security Audit](SECURITY_AUDIT_REPORT.md) — Security findings and status

## Reports
- [Pre-Release Audit](reports/pre-release-audit-report.md) — Comprehensive codebase audit

## Historical / Research
- [Tech Debt Report](tech-debt-report.md) — Original audit (partially stale)
- [Copilot SDK Deep Dive](copilot-sdk-deep-dive.md) — Research notes
- ...
```

---

## Workstream H: Infrastructure

### H1: Add macOS/Linux Release Targets

**File**: `.github/workflows/release.yml`

Add matrix strategy to `build-installers` job:
```yaml
strategy:
  matrix:
    include:
      - os: windows-latest
        target: x86_64-pc-windows-msvc
      - os: macos-latest
        target: aarch64-apple-darwin
      - os: ubuntu-latest
        target: x86_64-unknown-linux-gnu
```

**Pre-work**: Test local builds on each platform. Linux needs webkit2gtk deps. macOS may need code signing setup.

### H2: Migrate from Deprecated serde_yaml

```bash
# In all Cargo.toml files that use serde_yaml:
# Replace serde_yaml = "0.9" with serde_yml = "0.0.12" (or latest)
```

Update all `use serde_yaml::` → `use serde_yml::`. API is similar but **not identical** — verify:
- `serde_yaml::from_str` → `serde_yml::from_str`
- `serde_yaml::to_string` → `serde_yml::to_string`
- `serde_yaml::Value` → `serde_yml::Value`
- Cross-crate error types: if any code references `serde_yaml::Error` in error enums or `From` impls, those must be updated to `serde_yml::Error`
- **Test thoroughly** after migration — run full `cargo test --workspace`

### H3: Cross-Platform Scripts

Create a `Justfile` (requires `just` — Rust-based task runner):
```just
# Build everything
build:
    pnpm install
    pnpm build
    cargo build

# Run all tests
test:
    cargo test --workspace --exclude tracepilot-desktop
    pnpm test

# Run lints
lint:
    cargo clippy --workspace --exclude tracepilot-desktop -- -D warnings
    pnpm lint

# Clean artifacts
clean:
    cargo clean
    {{if os() == "windows"}} powershell -c "Remove-Item -Recurse -Force apps/desktop/dist, node_modules/.cache -ErrorAction SilentlyContinue" {{else}} rm -rf apps/desktop/dist node_modules/.cache {{end}}
```

### H4: Fix .gitignore Gaps

```gitignore
# Add to .gitignore:
coverage/
*.log
pnpm-debug.log*
.cache/
.turbo/
.env
.env.*
!.env.example
```

### H5: Fix Package Module Resolution

**Files**: `packages/client/package.json`, `packages/types/package.json`

Currently point `main` at `.ts` source files. Either:
- **Option A**: Add build step (`tsc`) and point main at `dist/`
- **Option B**: Use `exports` field with Vite-compatible conditions:

```json
{
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  }
}
```

This works because all consumers use Vite/bundler resolution. For Node.js CLI consumers, Option A is needed.

> **Critical: `@tracepilot/types` requires Option A.** The CLI (`apps/cli`) uses `tsx` (Node.js with TypeScript). While `tsx` handles `.ts` imports in dev, `npm pack` or any published consumption would fail. Since these are internal workspace packages never published to npm, Option B technically works — but for `@tracepilot/types`, **Option A (build to `dist/`) is required** at minimum for reliable CLI builds. The CLI build is currently broken because of this issue.
>
> **Recommendation**: Use **Option A** for `@tracepilot/types` (build step required for CLI). **Option B** is acceptable for `@tracepilot/client` if it remains Vite-only/internal.

---

## Workstream I: Polish (Tier 4)

These are self-contained, low-risk improvements:

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| I1 | TabNav arrow-key roving focus | `TabNav.vue` | Medium |
| I2 | Virtual scrolling for lists | `SessionListView.vue`, event lists | Medium |
| I3 | ViewCodeRenderer extensionless fix | `ViewCodeRenderer.vue` | Tiny |
| I4 | TokenBar progressbar role | `TokenBar.vue` | Tiny |
| I5 | Responsive chart handling | Chart views | Small |
| I6 | Remove design prototype dead weight | `docs/design/prototypes/shared/` | Tiny |
| I7 | Clean up @tracepilot/config | Remove or populate | Tiny |
| I8 | Address remaining 11 security items | Various | Medium |
| I9 | Scope Ctrl+K shortcut | `SearchPalette.vue:173-181` | Tiny |
| I10 | FormSwitch required aria-label | `FormSwitch.vue` | Tiny |

Each of these can be done as a standalone PR with minimal review overhead.

---

## Uncovered Audit Items

The following findings from the pre-release audit (§ references) have **no coverage** in any implementation plan workstream. These should be triaged and assigned to future workstreams:

| Audit § | Finding | Severity |
|---------|---------|----------|
| §2.5 | Cross-boundary type safety drift — timestamps, status fields, and `HealthFlag.severity` lack shared validation between Rust ↔ TS boundaries | HIGH |
| §2.6 | Stringly-typed data in Rust — `shutdown_type`, `HealthFlag.category`, and similar fields use raw strings instead of enums | HIGH |
| §7.1 | N+1 query in search — disk I/O per FTS result instead of batched reads | HIGH |
| §7.2 | Full event re-parse on every paginated request — no cursor/cache for pagination | HIGH |
| §7.5 | Inline computed calls in `ConversationTab` template — reactive overhead on every render | MEDIUM |

---

## Review Notes

This plan was updated based on a **4-model review** (Claude Opus, Claude Sonnet, GPT, Codex) with the following corrections applied:

1. **F1**: Line count corrected from 2,328 → 2,571. Added critical context about existing inline `mod commands { ... }` block and correct migration path (convert inline → filesystem, not create from scratch). Added `pub use` re-export pattern for `generate_handler!` compatibility. Added `build.rs` sync requirement (Codex finding).
2. **F2**: Marked as **already complete** — `AGENT_COLORS` is already shared via `@tracepilot/ui/utils/agentTypes`.
3. **F5**: `Badge.vue` `useSlots` changed from "Remove" to "Verify before removing" — the variable may be used in the template.
4. **H2**: Expanded `serde_yaml` → `serde_yml` migration notes with specific API mappings and error type considerations.
5. **H3**: Fixed `clean` target — `rm -rf` is not cross-platform. Added `just` conditional for Windows/Unix.
6. **H5**: Added critical note that `@tracepilot/types` **requires Option A** (build step) for CLI consumption. Option B only works for Vite-only packages.
7. **Uncovered Audit Items**: Added section for audit findings (§2.5, §2.6, §7.1, §7.2, §7.5) with no plan coverage.
