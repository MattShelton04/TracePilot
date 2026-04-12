# Implementation Plan 3: Frontend Reliability (Workstream C)

**Priority**: Tier 2 — HIGH IMPORTANCE  
**Estimated Scope**: ~300 lines of changes across ~12 files  
**Dependencies**: None (can start immediately, parallel with Workstreams A/B)

---

## C1: Fix Async Race Conditions in 5 Stores

> **Note**: The generation-token pattern repeats across 5+ stores. Consider extracting a generic `useAsyncState` composable (or similar) to reduce copy-paste and ensure consistent guard logic across all async store operations.

### C1a: `preferences.ts` — scheduleSave() race

**File**: `apps/desktop/src/stores/preferences.ts:236-255`

**Current code** (problematic):
```ts
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (!hydrated) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const freshConfig = await getConfig();       // ← stale if another save started
      backendConfig = freshConfig;
      const config = buildConfig();
      await saveConfig(config);
      backendConfig = config;
    } catch (e) { console.warn(...); }
  }, 300);
}
```

**Fix**: Add a generation token to discard stale completions:
```ts
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveGeneration = 0;

function scheduleSave() {
  if (!hydrated) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const gen = ++saveGeneration;
    try {
      const freshConfig = await getConfig();
      if (gen !== saveGeneration) return; // superseded
      backendConfig = freshConfig;
      const config = buildConfig();
      await saveConfig(config);
      if (gen !== saveGeneration) return; // superseded
      backendConfig = config;
    } catch (e) {
      if (gen !== saveGeneration) return;
      console.warn("[preferences] Failed to persist config:", e);
    }
  }, 300);
}
```

### C1b: `search.ts` — fetchFacets() race

**File**: `apps/desktop/src/stores/search.ts:233-252`

**Fix**: Add a facet generation guard mirroring `searchGeneration`:
```ts
let facetGeneration = 0;

async function fetchFacets(forQuery?: string) {
  const gen = ++facetGeneration;
  try {
    // ... existing filter setup ...
    const result = await getSearchFacets(forQuery, { ... });
    if (gen !== facetGeneration) return;
    facets.value = result;
  } catch (e) {
    if (gen !== facetGeneration) return;
    console.warn('Failed to fetch search facets:', e);
  }
}
```

### C1c: `worktrees.ts` — loadBranches() race

**File**: `apps/desktop/src/stores/worktrees.ts:143-148`

**Fix**: Add a branch-load generation token:
```ts
let branchGeneration = 0;

async function loadBranches(repoPath: string) {
  const gen = ++branchGeneration;
  // ... existing code ...
  const result = await listBranches(repoPath);
  if (gen !== branchGeneration) return;
  branches.value = result;
}
```

### C1d: `sessionDetail.ts` — reset() token bump

**File**: `apps/desktop/src/stores/sessionDetail.ts:276-291`

> Lines 77-93 contain the `requestToken` declaration and the start of `loadDetail()`, not `reset()`. The actual `reset()` function is at lines 276-291.

**Fix**: Bump `requestToken` in `reset()`:
```ts
function reset() {
  requestToken++;  // ← ADD THIS LINE
  session.value = null;
  turns.value = [];
  // ... rest of reset ...
}
```

### C1e: `worktrees.ts` — loadAllWorktrees() race

**File**: `apps/desktop/src/stores/worktrees.ts:105-121`

Concurrent add/delete operations can trigger `loadAllWorktrees()` while a previous call is still in-flight, causing the earlier (stale) response to overwrite the newer state.

**Fix**: Add a generation token similar to C1c:
```ts
let worktreeGeneration = 0;

async function loadAllWorktrees() {
  const gen = ++worktreeGeneration;
  // ... existing code ...
  const result = await getAllWorktrees();
  if (gen !== worktreeGeneration) return;
  worktrees.value = result;
}
```

### Acceptance Criteria
- Fast navigation between sessions/searches doesn't show stale data
- `pnpm --filter @tracepilot/desktop test` passes
- `pnpm --filter @tracepilot/desktop typecheck` passes

---

## C2: Surface Store Errors to UI

**File**: `apps/desktop/src/stores/sessionDetail.ts:162-274`

**Effort**: Medium-High

7 load functions currently catch errors and only `console.error`. **The store does NOT have `sectionErrors` reactive state** — it only has:
```ts
const loading = ref(false);
const error = ref<string | null>(null);
const loaded = ref<Set<string>>(new Set());
```

**Fix (Step 1)**: Add new section-level error state to the store:
```ts
// NEW STATE to add to sessionDetail.ts:
const sectionErrors = ref<Record<string, string | null>>({});

function setSectionError(section: string, msg: string) {
  sectionErrors.value[section] = msg;
}
function clearSectionError(section: string) {
  sectionErrors.value[section] = null;
}
```

**Fix (Step 2)**: Each catch block should set section error state:
```ts
// Example pattern for each load function:
async function loadTurns(sessionId: string) {
  const token = ++requestToken;
  clearSectionError('turns');
  try {
    const data = await getSessionTurns(sessionId);
    if (token !== requestToken) return;
    turns.value = data;
  } catch (e) {
    if (token !== requestToken) return;
    setSectionError('turns', String(e));  // ← ADD
  }
}
```

**Fix (Step 3)**: Expose `sectionErrors` from the store composable return value.

**Fix (Step 4)**: Update tab components (`EventsTab`, `OverviewTab`, `TokenFlowTab`) to:
- Read `sectionErrors` from the store
- Render `ErrorState` component with retry hooks when a section error exists
- These components do NOT currently read `sectionErrors` (it doesn't exist yet)

### Acceptance Criteria
- When backend fails, tabs show ErrorState with retry button instead of blank content
- Console still logs for debugging

---

## C3: Add Window-Level Error Handlers

**File**: `apps/desktop/src/main.ts`

A Vue `app.config.errorHandler` already exists at line 19-25. Add window-level handlers:

```ts
// After app.config.errorHandler setup:
window.addEventListener('error', (event) => {
  console.error('[window.onerror]', event.error);
  // Optionally: send to backend logging
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
  // Optionally: send to backend logging
});
```

### Acceptance Criteria
- Uncaught promise rejections are logged
- `pnpm --filter @tracepilot/desktop typecheck` passes

---

## C4: Replace Promise.all with Promise.allSettled

**File**: `apps/desktop/src/stores/configInjector.ts:47-67`

```ts
// BEFORE
const [agentsData, config, versionsData, active, backupsData] = await Promise.all([...]);

// AFTER
const [agentsRes, configRes, versionsRes, activeRes, backupsRes] = await Promise.allSettled([
  getAgentDefinitions(),
  getCopilotConfig(),
  discoverCopilotVersions(),
  getActiveCopilotVersion(),
  listConfigBackups(),
]);

if (agentsRes.status === 'fulfilled') agents.value = agentsRes.value;
if (configRes.status === 'fulfilled') copilotConfig.value = configRes.value;
if (versionsRes.status === 'fulfilled') versions.value = versionsRes.value;
if (activeRes.status === 'fulfilled') activeVersion.value = activeRes.value;
if (backupsRes.status === 'fulfilled') backups.value = backupsRes.value;

// Collect failures for error display
const failures = [agentsRes, configRes, versionsRes, activeRes, backupsRes]
  .filter((r): r is PromiseRejectedResult => r.status === 'rejected');
if (failures.length > 0) {
  error.value = failures.map(f => String(f.reason)).join('; ');
}
```

### Acceptance Criteria
- If one backend call fails, others still populate
- Error message shows which calls failed

---

## C5: Fix Wrong Settings Path

**File**: `apps/desktop/src/components/settings/SettingsDataStorage.vue:25`

```ts
// BEFORE
const sessionsDirectory = ref('~/.copilot/sessions/');

// AFTER
const sessionsDirectory = ref('~/.copilot/session-state/');
```

> Better approach: Read from config instead of hardcoding. Check if the config's `paths.sessionStateDir` is available at this point.

---

## C6: Fix Config Persistence — Add renderMarkdown to Rust

**File**: `crates/tracepilot-tauri-bindings/src/config.rs:156-175`

```rust
// BEFORE
pub struct FeaturesConfig {
    #[serde(default)]
    pub export_view: bool,
    #[serde(default)]
    pub health_scoring: bool,
    #[serde(default)]
    pub session_replay: bool,
}

// AFTER
pub struct FeaturesConfig {
    #[serde(default)]
    pub export_view: bool,
    #[serde(default)]
    pub health_scoring: bool,
    #[serde(default)]
    pub session_replay: bool,
    #[serde(default = "default_true")]
    pub render_markdown: bool,
}

fn default_true() -> bool { true }
```

Update the `Default` impl:
```rust
impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            export_view: false,
            health_scoring: false,
            session_replay: false,
            render_markdown: true,
        }
    }
}
```

### Acceptance Criteria
- Toggle renderMarkdown in settings → restart app → setting persists
- `cargo test` passes

---

## C7: Config Migration Scaffolding

**File**: `crates/tracepilot-tauri-bindings/src/config.rs:281-300`

```rust
// AFTER — version-aware loading
pub fn load() -> Option<Self> {
    let path = config_file_path()?;
    let content = std::fs::read_to_string(&path).ok()?;

    // Try parsing as current version first
    match toml::from_str::<Self>(&content) {
        Ok(mut config) => {
            let migrated = Self::migrate(&mut config);
            if migrated {
                tracing::info!("Migrated config from v{} to v{}", config.version, CURRENT_CONFIG_VERSION);
                if let Err(e) = config.save() {
                    tracing::warn!("Failed to persist migrated config: {e}");
                }
            }
            Some(config)
        }
        Err(e) => {
            tracing::warn!("Failed to parse config.toml: {e}; using defaults");
            None
        }
    }
}

const CURRENT_CONFIG_VERSION: u32 = 2;

fn migrate(config: &mut Self) -> bool {
    let mut migrated = false;
    // Future migrations go here:
    // if config.version < 3 { ... config.version = 3; migrated = true; }
    if config.version < CURRENT_CONFIG_VERSION {
        config.version = CURRENT_CONFIG_VERSION;
        migrated = true;
    }
    migrated
}
```

### Acceptance Criteria
- Old config files (version 1) load without error
- Config is automatically bumped to current version on disk

---

## C8: Lazy-Load Mock Data

**File**: `packages/client/src/index.ts:34-47`

Simply lazy-loading is not enough — **ALL static imports from `./mock/index.js` must be removed**, or Vite's tree-shaking will keep mocks in the main chunk regardless.

```ts
// BEFORE — eager import at module level (MUST BE FULLY REMOVED)
import { getMockSessionDetail, MOCK_ANALYTICS, ... } from './mock/index.js';

// AFTER — lazy import only when needed
async function getMockModule() {
  return import('./mock/index.js');
}
```

**Additional changes required**:
- `getMockData()` must become `async` since it now depends on a dynamic import
- All `invoke()` calls that use mock fallbacks must `await` the lazy import
- `getHealthScores()` and `exportSessions()` also reference mocks and must lazy-load them
- Instead of building one huge mock object eagerly, use an async switch-based resolver:

```ts
// Example: async mock resolver
async function resolveMock(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const mocks = await import('./mock/index.js');
  switch (command) {
    case 'get_sessions': return mocks.MOCK_SESSIONS;
    case 'get_session_detail': return mocks.getMockSessionDetail(args?.id as string);
    case 'get_analytics': return mocks.MOCK_ANALYTICS;
    // ... etc
    default: throw new Error(`No mock for command: ${command}`);
  }
}
```

### Acceptance Criteria
- `pnpm build` produces smaller JS bundle (mock data excluded from main chunk)
- No static imports from `./mock/index.js` remain in the production entry point
- App still works in dev mode (non-Tauri fallback)

---

## C9: Clean Up Timer/Observer Leaks

### ConfigInjectorView.vue
```ts
// Add to script setup:
onUnmounted(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
});
```

### SessionListView.vue
```ts
// Add to script setup:
onUnmounted(() => {
  if (driftTimeout) clearTimeout(driftTimeout);
});
```

### ConversationTab.vue
```ts
// Track observers and timers:
const activeObservers: IntersectionObserver[] = [];
const activeTimers: ReturnType<typeof setTimeout>[] = [];

function scrollAndHighlight(el: HTMLElement) {
  // ... existing code, but push observer/timers to arrays ...
  activeObservers.push(observer);
  activeTimers.push(highlightTimer);
  activeTimers.push(disconnectTimer);
}

onUnmounted(() => {
  activeObservers.forEach(o => o.disconnect());
  activeTimers.forEach(t => clearTimeout(t));
});
```

> **Alternative**: A single `AbortController` or cleanup-on-next-call pattern may be more robust than array tracking. Each call to `scrollAndHighlight` would abort the previous controller's signal, automatically cleaning up observers and timers tied to it, eliminating the need to manually track arrays.

### Acceptance Criteria
- No timer/observer console warnings after navigation
- `pnpm --filter @tracepilot/desktop test` passes

---

## Additional Items from Audit (No Plan Coverage)

The following issues were identified during the 4-model audit but are **not yet covered** by implementation items C1–C9. They should be triaged for future workstreams or folded into existing items as noted.

| Audit Ref | Summary | Suggested Action |
|-----------|---------|-----------------|
| §9.6 | Feature-flag guard race with preferences hydration — flags may be read before `hydrated` is true, causing incorrect UI state on first render | New item or extend C1a |
| §9.7 | No `router.onError()` handler — navigation failures are silently swallowed | **Add to C3** (window-level error handlers) |
| §9.8 | `SearchPalette` masks backend failures as "no results" — user sees empty state instead of error feedback | **Add to C2** (surface store errors to UI) |
| §2.15 | `SqlResultRenderer` null crash on `[null]` JSON — rendering a result set containing `[null]` throws an unhandled exception | New bug fix item |
| §2.16 | `FormInput` emits `0` for empty numeric fields — clearing a numeric input sends `0` instead of `null`/`undefined` | New bug fix item |
| §7.1 | N+1 query in search: disk I/O per FTS result instead of batched lookup | Performance — new item |
| §7.2 | Full event re-parse on every paginated request instead of caching parsed structure | Performance — new item |

---

## Review Notes

This plan was updated based on a **4-model cross-review** (Claude, Gemini, GPT, independent audit).

**Key corrections applied:**

1. **C1d line reference**: Fixed from `sessionDetail.ts:77-93` → `sessionDetail.ts:276-291`. Lines 77-93 contain `requestToken` declaration and start of `loadDetail()`, not `reset()`.
2. **C1e added**: New race condition identified in `worktrees.ts:105-121` (`loadAllWorktrees()`), where concurrent add/delete gets reverted by stale responses.
3. **C1 composable note**: Added suggestion to extract a generic `useAsyncState` composable to DRY up the generation-token pattern. *(Gemini suggestion)*
4. **C2 major correction**: The store does **not** have `sectionErrors` reactive state — only `loading`, `error`, and `loaded` refs exist. Rewrote C2 to include creating the state, helper functions, store exposure, and tab component updates. Bumped effort to Medium-High.
5. **C8 expanded**: Lazy-loading alone is insufficient — all static imports from `./mock/index.js` must be fully removed. Added requirements for async `getMockData()`, per-function lazy loading, and switch-based mock resolver pattern.
6. **C9 alternative noted**: Added `AbortController`/cleanup-on-next-call as a more robust alternative to array-based observer/timer tracking.
7. **Uncovered items catalogued**: 7 audit findings (§9.6, §9.7, §9.8, §2.15, §2.16, §7.1, §7.2) documented for future triage.
