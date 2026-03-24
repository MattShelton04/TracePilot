# TracePilot Pre-Release Regression Checklist

> Generated from the implementation audit fixes (commits d5d804b..HEAD).
> Test each area manually after the changes to verify no regressions.

---

## 1. Rust Safety — Lock Poison Recovery

### 1.1 Config Read (lib.rs `read_config`)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 1 | Launch app normally | Config loads, all settings reflected in UI | ☐ |
| 2 | Open Settings → change theme → reload app | Theme persists across restart | ☐ |
| 3 | Delete/corrupt config TOML → launch app | App starts with defaults, no crash | ☐ |

### 1.2 Turn Cache (lib.rs cache Mutex)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 4 | Open a session → Conversation tab | Turns load and display correctly | ☐ |
| 5 | Switch between sessions rapidly | Each session shows its own turns, no stale data | ☐ |
| 6 | Re-open same session | Turns load from cache (faster), data is correct | ☐ |

### 1.3 Config Write (save_config / factory_reset)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 7 | Settings → change any preference → check TOML file | Config file updated on disk | ☐ |
| 8 | Settings → Factory Reset | Config cleared, app resets to defaults | ☐ |

### 1.4 App Startup (main.rs)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 9 | Launch app normally | Window appears, no error in console | ☐ |
| 10 | Check system tray / taskbar | App icon and window title correct | ☐ |

---

## 2. Config — renderMarkdown Field (C6)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 11 | Settings → Appearance → Markdown rendering toggle | Toggle visible, reflects current state | ☐ |
| 12 | Enable markdown → open Conversation tab | Messages rendered as rich markdown (bold, code blocks, links) | ☐ |
| 13 | Disable markdown → open Conversation tab | Messages shown as plaintext | ☐ |
| 14 | Enable markdown → open Replay view | Replay content rendered as markdown | ☐ |
| 15 | Enable markdown → open Agent Tree (Timeline) | Agent tree content rendered as markdown | ☐ |
| 16 | Old config file (without renderMarkdown field) | App starts normally, markdown defaults to enabled | ☐ |

---

## 3. Frontend Error Handling (C3)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 17 | Normal usage — navigate between views | No spurious errors in dev console | ☐ |
| 18 | Check DevTools console during normal workflow | No duplicate error logging (Vue + window handler) | ☐ |

---

## 4. Config Injector Resilience (C4)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 19 | Navigate to Copilot Orchestration view | Agents, config, versions, backups all load | ☐ |
| 20 | If one Copilot source missing (e.g., no agents file) | Other sections still load; error shown for failed one | ☐ |
| 21 | Edit an agent definition → save | Agent saved correctly | ☐ |
| 22 | Versions tab → view installed versions | Version list renders | ☐ |
| 23 | Backups tab → view/preview/restore backup | Backup operations work | ☐ |

---

## 5. Race Conditions — Generation Tokens (C1a–d)

### 5.1 Preferences Save (C1a)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 24 | Settings → rapidly toggle theme back and forth | Final theme matches last selection | ☐ |
| 25 | Change hide-empty-sessions → immediately change CLI command | Both settings saved correctly | ☐ |
| 26 | Change any setting → close app quickly → reopen | Last setting persisted | ☐ |

### 5.2 Search Facets (C1b)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 27 | Search view → type query → facet counts update | Content type counts match search results | ☐ |
| 28 | Rapidly type different queries | Facets match the final query, no stale counts | ☐ |
| 29 | Apply content-type filter → check facets | Facets reflect filtered state | ☐ |
| 30 | Clear all filters | Facets return to unfiltered state | ☐ |

### 5.3 Worktree Branches (C1c)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 31 | Worktree Manager → select a repository | Branch list loads for that repo | ☐ |
| 32 | Rapidly switch between repos | Branch list matches the selected repo | ☐ |
| 33 | Create Worktree modal → change repo inside modal | Branch dropdown updates to new repo's branches | ☐ |
| 34 | Fetch Latest from Remote → branch list refreshes | Updated branches appear | ☐ |

### 5.4 Session Detail Reset (C1d)
| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 35 | Click a session → quickly click a different session | Second session data loads cleanly, no flash of first | ☐ |
| 36 | Session detail → navigate away → come back | Data loads fresh, no stale state | ☐ |
| 37 | Session detail → switch to Replay view of same session | Data shared correctly (no double-load or stale) | ☐ |
| 38 | Events tab → switch sessions while events loading | New session's events load, old request cancelled | ☐ |

---

## 6. Timer/Observer Cleanup (C9)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 39 | Search → click result → conversation scrolls to turn | Turn highlighted, animation plays for ~4s | ☐ |
| 40 | Search → click result with event param | Tool call expanded, event element highlighted | ☐ |
| 41 | Click different search results in same session | Each scroll works; previous highlight cleared | ☐ |
| 42 | Navigate away from Conversation tab during highlight | No console errors about destroyed component | ☐ |
| 43 | Navigate away immediately after clicking search result | No lingering timers or observer warnings | ☐ |

---

## 7. Lazy-Loaded Mock Data (C8)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 44 | Run `pnpm dev` (Vite dev server, no Tauri) | App boots in browser with mock data | ☐ |
| 45 | Dev mode → navigate session list | Mock sessions displayed | ☐ |
| 46 | Dev mode → click a session → view turns | Mock turns/events render | ☐ |
| 47 | Dev mode → search | Mock search results return | ☐ |
| 48 | Production Tauri build | Mock module NOT loaded (verify no mock imports in bundle) | ☐ |

---

## 8. CI/CD Pipeline (B1, B4, B5)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 49 | Push to `main` branch | CI runs (check, test, typecheck, build, audit) | ☐ |
| 50 | Open PR targeting `main` | CI runs on PR | ☐ |
| 51 | CI: `pnpm build` step | Frontend builds successfully | ☐ |
| 52 | CI: `cargo check` step | Rust workspace compiles | ☐ |
| 53 | CI: `rustsec/audit-check` step | Security audit runs (may find advisories) | ☐ |

---

## 9. Release Build Profile (A4)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 54 | `cargo build --release` (if feasible) | Binary builds with LTO, stripped | ☐ |
| 55 | Release binary size | Should be smaller than unoptimized build | ☐ |

---

## 10. Cross-Cutting Regression Checks

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 56 | All existing automated tests pass | `cargo test` (275), desktop tests (245), UI tests (449) | ☐ |
| 57 | App startup cold boot | Loads within expected time, no spinner stuck | ☐ |
| 58 | Navigate: Session List → Session Detail → Tabs → Back | All views render without errors | ☐ |
| 59 | Navigate: Search → Results → Click result → Conversation | Full flow works end-to-end | ☐ |
| 60 | Navigate: Settings (all tabs) | All settings tabs render and save | ☐ |
| 61 | Navigate: Worktree Manager | Repos/branches/worktrees load | ☐ |
| 62 | Navigate: Analytics Dashboard | Charts render with data | ☐ |
| 63 | Navigate: Tool Analysis | Tool breakdown renders | ☐ |
| 64 | Navigate: Code Impact | Code impact data renders | ☐ |
| 65 | Keyboard navigation (Tab, Enter, Esc) | Focus management works | ☐ |
| 66 | Window resize / responsive layout | Views adapt without breaking | ☐ |

---

## Summary

| Category | Tests | Coverage |
|----------|-------|----------|
| Rust Safety | 1–10 | Lock poison recovery, startup |
| Config (renderMarkdown) | 11–16 | Serde default, UI toggle |
| Error Handling | 17–18 | Window error handlers |
| Config Injector | 19–23 | Promise.allSettled resilience |
| Race Conditions | 24–38 | Generation tokens, session switching |
| Timer/Observer | 39–43 | Scroll highlight cleanup |
| Mock Data | 44–48 | Lazy loading, dev mode |
| CI/CD | 49–53 | PR trigger, build, audit |
| Release Profile | 54–55 | LTO, strip |
| Cross-Cutting | 56–66 | Full app navigation |
| **Total** | **66** | |
