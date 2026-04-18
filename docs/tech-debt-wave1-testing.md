# Wave 1 — Manual Testing Guide

This guide covers the wave-1 tech-debt hardening. It complements the automated suite
(1218 vitest + cargo tests all green) with manual checks that exercise the new
security guards and lifecycle changes in the real app.

> Scope: Phase 0 guard-rails + Phase 1A (minus 1A.1 capability scoping and 1A.4
> shell-split, which are deferred to wave 2).

## 1. Prerequisites

- `pnpm install` + `cargo build` on your branch.
- Clean `~/.tracepilot` or a sandboxed user data dir recommended for path tests.
- Have one MCP config file handy for the SSRF test.

## 2. Phase 0 guard-rails

### 2.1 File-size budget
```powershell
node scripts/check-file-sizes.mjs
```
- ✅ Should print "✓ N allow-listed" and exit 0.
- Sanity: open any large allow-listed Vue file, append a dummy blank line, re-run.
  Still passes (it's already allow-listed). Delete the blank line.
- Regression: create a brand-new file `apps/desktop/src/junk.vue` with 1100+
  lines. Re-run → must exit 1 with the new path listed. Delete the file.

### 2.2 Pre-push hooks
```powershell
git add -N .           # stage nothing, just poke lefthook
pnpm exec lefthook run pre-push
```
- Expect: typecheck, rustfmt check, and filesize run in sequence.
- No clippy auto-fix (by design).

### 2.3 CI matrix (requires push)
- Push branch → GitHub Actions.
- Confirm jobs: `build-test (ubuntu-latest)`, `build-test (windows-latest)`,
  `build-test (macos-latest)`, and a separate `security` job on Linux only.
- Dependabot PRs: check `.github/dependabot.yml` is enabled (Insights → Dependency
  graph → Dependabot).

## 3. Phase 1A.2 — Path jail (explorer + terminal)

### 3.1 Explorer happy path
In the app, open a known local folder via "Open in Explorer" (wherever this is
exposed — session folder, skills dir, etc.).
- ✅ Explorer opens at the correct location.
- ✅ Verbatim `\\?\C:\…` prefix is stripped (no weird shell path).

### 3.2 UNC rejection
Temporarily point a path setting at `\\some-server\share` (or craft an invoke
call via the dev console).
- ✅ Backend returns an error envelope; app surfaces a validation-style message.
- ✅ No explorer window opens to the UNC location.

### 3.3 Nonexistent / traversal
Pass `C:\does\not\exist` or `C:\git\TracePilot\..\..\Windows\System32`.
- ✅ Canonicalization rejects the traversal / nonexistent path.

## 4. Phase 1A.3 — MCP URL policy (SSRF)

In Settings → MCP (or your MCP config), try to add/enable a server with each of
these HTTP URLs:

| URL | Expected |
|-----|----------|
| `http://127.0.0.1:8080/` | ❌ rejected (loopback) |
| `http://localhost:8080/` | ❌ rejected (resolves to loopback) |
| `http://10.0.0.5/` | ❌ rejected (RFC1918) |
| `http://192.168.1.5/` | ❌ rejected (RFC1918) |
| `http://169.254.169.254/latest/` | ❌ rejected (cloud metadata) |
| `http://100.64.0.1/` | ❌ rejected (CGNAT) |
| `http://[fc00::1]/` | ❌ rejected (IPv6 ULA) |
| `file:///etc/passwd` | ❌ rejected (scheme) |
| `ftp://example.com/` | ❌ rejected (scheme) |
| `https://example.com/` | ✅ permitted |

The health check in `mcp/health.rs::check_http_server` should short-circuit
before any network I/O for the rejected cases.

## 5. Phase 1A.5 — Structured IPC error envelope

### 5.1 ALREADY_INDEXING
Trigger two concurrent indexing runs (kick off re-index, then immediately kick
off a second while the first is running).
- ✅ Toast / inline error shows the friendly message
  `"Indexing is already in progress."` (not the literal code).
- In the dev console: `err` object should be `{ code: "ALREADY_INDEXING", message: "..." }`.
- `getErrorCode(err)` returns `"ALREADY_INDEXING"`.
- `isAlreadyIndexingError(err)` returns `true`.

### 5.2 Validation errors
Submit an invalid form (bad date range, empty required field, etc.) that maps
to `BindingsError::Validation`.
- ✅ Message shown is the human-readable reason from the backend.
- Envelope `code === "VALIDATION"`.

### 5.3 Legacy string-based guards
Any code path that still feeds `toErrorMessage(e)` into `isAlreadyIndexingError`
must still work via the lowercase substring fallback. Grep references:
- `apps/desktop/src/stores/sessions.ts`
- `apps/desktop/src/components/settings/SettingsDataStorage.vue`

## 6. Phase 1A.6 — Broadcast channel capacity

Run a long task with aggressive status updates (indexing a large repo).
- ✅ No `lagged` warnings in the orchestrator log.
- Previous bound was 16; now 256, so intermittent UI pauses should no longer drop
  intermediate states.

## 7. Phase 1A.7 — Window lifecycle composable

### 7.1 HMR
In dev mode, save `App.vue` to trigger HMR.
- Open dev tools → Memory → check there is exactly one `tauri://close-requested`
  listener after several HMR cycles (not N).

### 7.2 Popup close
Open the alert popup, close it via the X.
- ✅ `onPopupClosed` fires once and no stale handlers remain after the parent
  scope tears down.

## 8. Rollback notes

If the new `{code, message}` error envelope causes unexpected Tauri invoke
behaviour:
1. Revert `crates/tracepilot-tauri-bindings/src/error.rs`'s `Serialize` impl to
   emit `serialize_str(&self.to_string())` (the old shape).
2. Remove envelope-shape branches in
   `apps/desktop/src/utils/backendErrors.ts` (keep `getErrorCode` returning
   `undefined` for non-envelope inputs).
3. Update tests accordingly.

Everything else in wave 1 is additive and safe to keep.

## 9. Deferred to wave 2 (explicit out-of-scope)

- Splitting `apps/desktop/src-tauri/capabilities/default.json` into main +
  viewer capability sets (Phase 1A.1).
- Adding `run_hidden_argv` helper and deprecating `run_hidden_shell` (Phase
  1A.4).
- Migrating `sessions.ts` / `SettingsDataStorage.vue` to call
  `getErrorCode(e) === "ALREADY_INDEXING"` directly.
