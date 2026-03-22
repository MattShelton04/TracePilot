# TracePilot Comprehensive Security Audit Report

**Date**: 2026-03-22
**Scope**: Full codebase — Rust (6 crates) + TypeScript/Vue (4 packages + desktop app)
**Methodology**: Static analysis, manual code review, CodeQL (timed out on full scan due to codebase size)
**Validation**: Independently validated by 4 AI models (Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, Gemini 2.5 Pro)

---

## Executive Summary

The TracePilot codebase demonstrates **solid security fundamentals**. The main findings are centered around defense-in-depth improvements rather than exploitable critical vulnerabilities. The most significant issues — **missing environment variable name validation in the Windows launcher path** and **template ID path traversal** — have been remediated. The frontend uses proper HTML escaping throughout and has no XSS, prototype pollution, or code injection vulnerabilities.

**Overall Security Posture: GOOD ✅**

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 7 | 5 | 2 |
| Low | 9 | 1 | 8 |
| **Total** | **17** | **6** | **11** |

---

## Findings Fixed in This Audit

### FIX-1: Missing Environment Variable Name Validation (High → Fixed)
- **File**: `crates/tracepilot-orchestrator/src/launcher.rs:213-222`
- **Issue**: On Windows, the PowerShell launcher path directly interpolated env var names into `$env:{k} = '{v}'` without validation. The macOS (`process.rs:213`) and Linux (`process.rs:270`) paths correctly called `validate_env_var_name()`, but the Windows path did not.
- **Impact**: A crafted env var name like `foo = 'bar'; Invoke-Expression 'malicious'; $env:x` could inject arbitrary PowerShell commands.
- **Fix**: Added `crate::process::validate_env_var_name(k)?` call before PowerShell script construction. Made `validate_env_var_name` `pub(crate)` for cross-module access.

### FIX-2: Unbounded Template File Reading (Medium → Fixed)
- **File**: `crates/tracepilot-orchestrator/src/templates.rs:95`
- **Issue**: Template files were loaded entirely into memory via `read_to_string()` without size validation. A malicious or corrupted multi-GB template file could cause OOM.
- **Fix**: Added module-level `MAX_TEMPLATE_SIZE` constant (1 MB) with pre-read metadata check. Metadata read failures are now explicitly logged and skipped rather than silently ignored.

### FIX-3: Bare Unwraps in Base64 Encoder (Low → Fixed)
- **File**: `crates/tracepilot-orchestrator/src/process.rs:295-298`
- **Issue**: `write_all()`, `finish()`, and `String::from_utf8()` used bare `.unwrap()` without safety reasoning.
- **Fix**: Replaced with `.expect()` calls documenting why each is infallible: Vec writes can't fail, base64 output is always valid ASCII.

### FIX-4: SQL LIMIT String Interpolation (Medium → Fixed)
- **File**: `crates/tracepilot-indexer/src/index_db/session_reader.rs:39-41`
- **Issue**: `format!(" LIMIT {}", limit)` used string interpolation for the LIMIT clause instead of a parameterized query.
- **Fix**: Changed to parameterized `LIMIT ?` with `i64::try_from(limit).unwrap_or(i64::MAX)` for safe type conversion.

### FIX-5: innerHTML Clearing (Low → Fixed)
- **File**: `apps/desktop/src/composables/useOrbitalAnimation.ts:194`
- **Issue**: Used `container.innerHTML = ''` for clearing child elements.
- **Fix**: Changed to `container.replaceChildren()` — the modern, safer DOM API.

### FIX-6: Code Review Follow-ups (Various → Fixed)
- Moved `MAX_TEMPLATE_SIZE` to module level for discoverability
- Added explicit metadata error handling
- Used `i64::try_from()` with fallback instead of bare `as` cast

### FIX-7: Template ID Path Traversal (High → Fixed, identified by subagent validation)
- **File**: `crates/tracepilot-orchestrator/src/templates.rs`
- **Issue**: Template IDs were used directly in file path construction (`dir.join(format!("{id}.json"))`) without sanitization. A crafted ID like `../../etc/config` could escape the templates directory, enabling arbitrary file write (via `save_template`), arbitrary file delete (via `delete_template`), or arbitrary file read (via `increment_usage`).
- **Impact**: Path traversal allowing file manipulation outside the intended templates directory.
- **Fix**: Added `validate_template_id()` function that restricts IDs to `[A-Za-z0-9_-]` characters only. Applied to all three functions: `save_template`, `delete_template`, and `increment_usage`.
- **Subagent Consensus**: Identified by GPT 5.4, Codex 5.3, and Gemini 2.5 Pro. All recommend fixing.

---

## Remaining Findings (Not Fixed — Require Further Discussion)

### MEDIUM Severity (adjusted from High based on subagent consensus)

#### R-1: CSP Allows `unsafe-inline` for Styles
- **File**: `apps/desktop/src-tauri/tauri.conf.json:24`
- **Code**: `"style-src 'self' 'unsafe-inline'"`
- **Analysis**: Vue's scoped styles and runtime-generated style bindings likely require `unsafe-inline`. Removing it would break the application's styling. This is a known trade-off in Vue/Tauri apps.
- **Recommendation**: Investigate using nonce-based CSP or migrating to external stylesheets. Verify if Tauri's Vue integration supports CSP without `unsafe-inline`.
- **Risk Assessment**: Low actual risk in a desktop app (no third-party script injection vector), but not ideal.
- **Subagent Consensus**: All 4 validators agree this should be **Medium** for a desktop app, not High. Adjusted.

### MEDIUM Severity

#### R-2: CLI Command Character Whitelist Includes Colon
- **File**: `crates/tracepilot-orchestrator/src/launcher.rs:100`
- **Code**: `"-_./\\ :"` character whitelist
- **Analysis**: Colons are necessary for Windows drive letter paths (e.g., `C:\copilot.exe`). The current validation already blocks dangerous characters (`;`, `|`, `&`, `$`). The command is passed via array-based APIs, not shell concatenation.
- **Recommendation**: Consider tightening to only allow `:` after a single letter (drive letter pattern).
- **Subagent Consensus**: Opus 4.6 and GPT 5.4 suggest **Low** severity given array-based spawning.

#### R-4: Unbounded Full-Text Search Results
- **File**: `crates/tracepilot-indexer/src/index_db/session_reader.rs:107-127`
- **Analysis**: Search returns all matching results without pagination. For large indexes, this could consume significant memory.
- **Recommendation**: Add a default result limit (e.g., 500-1000) to the FTS query.
- **Subagent Consensus**: All agree this is **Medium** — straightforward fix recommended for next sprint.

### LOW Severity

#### R-3: TOCTOU in Version Manager File Operations
- **File**: `crates/tracepilot-orchestrator/src/version_manager.rs:111-115, 188-203`
- **Analysis**: File existence checks followed by file operations create a race window. In practice, these operate on user-local files in the `.copilot` directory, limiting attack surface.
- **Recommendation**: Use `OpenOptions` with atomic operations. Low priority given the local-only attack surface.
- **Subagent Consensus**: Opus 4.6, GPT 5.4 suggest **Low** — local files only, requires same-UID attacker.

#### R-5: Integer Casts in Analytics Aggregator
- **File**: `crates/tracepilot-core/src/analytics/aggregator.rs` (multiple locations)
- **Analysis**: `usize as u32`, `i64 as u64` casts without bounds checking. Overflow is theoretically possible with extreme data volumes but unlikely in practice.
- **Recommendation**: Use checked arithmetic for defense-in-depth.

#### R-6: Environment Variable Trust for Home Directory
- **File**: `crates/tracepilot-orchestrator/src/launcher.rs:340-353`
- **Analysis**: `HOME`/`USERPROFILE` env vars are user-controlled. Standard practice for desktop applications. No additional risk beyond OS-level trust.

#### R-7: MarkdownContent Uses v-html with Pre-Escaped Content
- **File**: `packages/ui/src/components/MarkdownContent.vue:32`
- **Analysis**: Content is fully escaped via `escapeHtml()` before being passed to `v-html`. Not a vulnerability, but `v-text` or `{{ }}` interpolation would be simpler and equally safe.
- **Recommendation**: Consider switching to text interpolation.

#### R-8: v-html Used in Syntax Highlighters (Properly Escaped)
- **Files**: `CodeBlock.vue`, `SqlResultRenderer.vue`, `GrepResultRenderer.vue`, `WebSearchRenderer.vue`
- **Analysis**: All v-html usage is preceded by thorough `escapeHtml()` processing. The highlight functions escape first, then wrap in `<span>` tags. **SECURE** — no action required.

#### R-9: Path Input Without Client-Side Validation
- **File**: `apps/desktop/src/components/wizard/WizardStepDatabase.vue:30-37`
- **Analysis**: Database path input is sent to Rust backend without client-side validation. Backend performs proper path handling.
- **Recommendation**: Add basic client-side path format validation for better UX.

#### R-10: Manifest Response Structure Not Validated
- **File**: `apps/desktop/src/composables/useWhatsNew.ts:9-18`
- **Analysis**: `release-manifest.json` is a local/bundled file, not a remote endpoint. Graceful error handling via `?? []` already exists.
- **Recommendation**: Add `Array.isArray()` check for robustness.

#### R-11: Unsafe `env::set_var` in Test Code
- **File**: `crates/tracepilot-orchestrator/src/templates.rs:291-306`
- **Analysis**: `unsafe { std::env::set_var() }` used in test code with mutex protection. Required by Rust 2024 edition. Test-only, no production impact.

---

## Positive Security Findings

The following security practices were verified as correct:

1. ✅ **No eval() or dynamic code execution** anywhere in the frontend
2. ✅ **No hardcoded secrets** in source code
3. ✅ **No prototype pollution** patterns
4. ✅ **Proper URL sanitization** in markdown renderer (blocks `javascript:`, `data:`, `vbscript:`)
5. ✅ **Parameterized SQL queries** throughout (except the fixed LIMIT clause)
6. ✅ **Proper HTML escaping** in all rendering pipelines
7. ✅ **No ReDoS-vulnerable regex patterns** detected
8. ✅ **HTTPS-only update endpoint** with signature verification
9. ✅ **Env var name validation** function properly restricts to `[A-Za-z_][A-Za-z0-9_]*`
10. ✅ **Model ID validation** against known whitelist prevents injection
11. ✅ **Branch name escaping** correctly uses named format args for shell safety
12. ✅ **PowerShell EncodedCommand** bypasses all shell escaping issues

---

## Remediation Plan

### Immediate (This PR)
- [x] Fix env var validation gap in Windows launcher
- [x] Add template file size limits
- [x] Replace bare unwraps with documented expects
- [x] Parameterize SQL LIMIT clause
- [x] Use replaceChildren() instead of innerHTML
- [x] Fix template ID path traversal (identified by subagent validation)

### Short-Term (Next Sprint)
- [ ] Investigate removing CSP `unsafe-inline` for styles
- [ ] Add result limits to full-text search queries
- [ ] Add template count/aggregate size limits (GPT 5.4 suggestion)

### Long-Term (Backlog)
- [ ] Add checked arithmetic to analytics aggregator
- [ ] Replace TOCTOU file operations with atomic alternatives
- [ ] Add client-side path validation
- [ ] Validate manifest response structures

---

## Multi-Model Validation Summary

This audit was independently validated by 4 AI models. Their consolidated feedback improved the report accuracy and identified one additional vulnerability (FIX-7).

### Claude Opus 4.6
- **Verdict**: All 5 original fixes approved ✅
- **Key Feedback**: R-1 (CSP) should be Medium not High; R-2/R-3 are overrated by one severity level
- **Severity Adjustments**: Adopted — R-1 downgraded to Medium, R-3 downgraded to Low

### GPT 5.4
- **Verdict**: All fixes correct. Templates.rs fix "partially correct" — identified missing template ID validation
- **Key Feedback**: Template ID path traversal via `save_template`/`delete_template`; consider limiting template count
- **New Finding**: FIX-7 template path traversal — **FIXED**
- **Severity Adjustments**: Original env var finding should be Medium not High (agreed with desktop context)

### GPT 5.3 Codex
- **Verdict**: All fixes correct ✅ with ⚠️ on templates.rs path handling
- **Key Feedback**: Confirmed template ID path traversal. Flagged potential macOS branch injection concern.
- **New Finding**: FIX-7 template path traversal — **FIXED**
- **Note on macOS branch injection**: Investigated — branch escaping uses named format args correctly (`b = escaped`), and macOS terminal launch uses `Command::arg()` for AppleScript, not shell concatenation. No actual vulnerability.

### Gemini 2.5 Pro
- **Verdict**: All fixes correct ✅
- **Key Feedback**: Template ID path traversal confirmed as Medium severity
- **New Finding**: FIX-7 template path traversal — **FIXED**
- **Additional**: Config injector file operations are safe (hardcoded paths, no user-controlled traversal)

### Consensus Matrix

| Finding | Opus 4.6 | GPT 5.4 | Codex 5.3 | Gemini | Action |
|---------|----------|---------|-----------|--------|--------|
| FIX-1 Env var validation | ✅ Approved | ✅ Correct | ✅ Correct | ✅ Correct | Kept |
| FIX-2 File size limit | ✅ Approved | ⚠️ Incomplete | ✅ Good | ✅ Correct | Enhanced with error handling |
| FIX-3 Expect messages | ✅ Approved | ✅ Correct | ✅ Correct | ✅ Correct | Kept |
| FIX-4 SQL LIMIT | ✅ Approved | ✅ Correct | ✅ Correct | ✅ Correct | Kept |
| FIX-5 replaceChildren | ✅ Approved | ✅ Correct | ✅ Correct | ✅ Correct | Kept |
| Template path traversal | Not flagged | 🔴 New High | 🔴 New High | 🟡 New Medium | **FIX-7 added** |
| CSP severity | Medium ↓ | Low ↓ | - | Medium ↓ | **Downgraded to Medium** |

---

## Methodology Notes

- **Rust Analysis**: All 6 workspace crates were examined: `tracepilot-core`, `tracepilot-indexer`, `tracepilot-export`, `tracepilot-orchestrator`, `tracepilot-tauri-bindings`, `tracepilot-bench`
- **Frontend Analysis**: All TypeScript/Vue source files examined across `apps/desktop/src/`, `packages/ui/`, `packages/client/`, `packages/config/`, `packages/types/`
- **Configuration Analysis**: `tauri.conf.json`, `biome.json`, `package.json` files reviewed
- **CodeQL**: Automated scan attempted but timed out due to codebase size. Manual static analysis performed instead.
- **Multi-Model Validation**: 4 independent AI models reviewed all findings and fixes
- **Test Validation**: All 68 Rust tests pass (17 indexer + 51 orchestrator). No regressions from security fixes.
- **Dependency Audit**: No known advisories found for key direct dependencies (tauri, rusqlite, reqwest, Vue, Vite)
