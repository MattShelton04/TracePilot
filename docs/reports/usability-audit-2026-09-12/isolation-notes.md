# Audit data isolation research

Source inspection on 2026-09-12. These notes describe the existing implementation;
they do not claim a profile has been launched or a native workflow verified.
The audit's coverage matrix records actual execution separately.

## Existing supported automation

- Start the real Windows Tauri app with `pnpm app:start` and use its printed
  Playwright CLI attachment command. `scripts/automation/ready.mjs` waits for
  either the sidebar **or Setup Wizard**, then checks a read-only Rust IPC call.
  A blank profile can therefore pass launcher readiness during onboarding.
- The launcher isolates the **WebView2 profile only**. Its normal application
  configuration, SQLite index, Copilot sessions and orchestration files remain
  the configured user's data. A second port does not isolate application data.
- Healthy instances are reused before spawning children. Stop the recorded
  checkout-owned instance with `pnpm app:stop` before changing its environment.
  Do not select processes by name or port or launch the binary around this helper.

## Application file roots

| Data | Resolution and source |
| --- | --- |
| Bootstrap config | `%USERPROFILE%/.copilot/tracepilot/config.toml`; `config::config_file_path()` uses `TracePilotPaths::try_default()` |
| Windows home lookup | `tracepilot-core/src/utils/mod.rs::home_dir_opt` directly reads `USERPROFILE` |
| Session root | Config `paths.sessionStateDir`, default `<Copilot home>/session-state` |
| Index | `<paths.tracepilotHome>/index.db`; `indexDbPath` is a derived compatibility field |
| Templates, registry and backups | Under configured TracePilot home in operations receiving config; default helpers still use the default Copilot home |
| Copilot config, MCP and global skills | Configured Copilot home for config-aware commands; default helpers also exist and resolve through Windows home |
| WebView profile | Checkout `.tracepilot/automation/webview-profile` |
| Tauri plugin log files | Native `app_log_dir`; separate from the TracePilot config root |
| Launcher stdout/stderr | Checkout `.tracepilot/automation/desktop-*.log` and `*.err.log` |

No desktop `TRACEPILOT_*` environment variable or launcher app-data profile flag
was found. `TRACEPILOT_SESSION_STATE_DIR`/`COPILOT_SESSION_STATE_DIR` belong to the
separate Node CLI, and do **not** redirect the Rust desktop configuration.

Changing the data directory in the running user's Settings is **not** a clean
isolation technique. `services/config.rs::save_config` copies the existing index,
repository registry, templates and backups when TracePilot home changes. It still
saves the bootstrap config at the default home path.

## Isolation approach justified by source

For a disposable **local application-data** profile, a fresh launcher child
environment can point `USERPROFILE` to an absolute task-owned directory beneath
the ignored checkout `.tracepilot` directory. This follows the actual Windows
home resolver and the existing isolated Rust template/MCP tests. It is an
implementation-supported environment technique, not a documented launcher flag.

Keep the real shell/user environment unchanged: provide the override only to the
launcher child process. Preserve absolute tool locations (especially existing
Cargo and Rustup homes), since Rustup also resolves tools from the user's profile.
Continue through `pnpm app:start`; do not bypass the launcher. Record startup
errors instead of modifying unrelated user settings. Ensure the resulting
configuration and session paths are visibly inside the disposable root before
any destructive audit action.

For onboarding, create only the disposable `.copilot/session-state` directories
and no bootstrap config. For a prepared populated fixture, the current TOML schema
is version 11, uses camelCase, requires a `[paths]` table and can use the following
keys (fill every path with an absolute task-owned location):

```toml
version = 11

[paths]
copilotHome = '<disposable root>/.copilot'
tracepilotHome = '<disposable root>/.copilot/tracepilot'
sessionStateDir = '<disposable root>/.copilot/session-state'
indexDbPath = '<disposable root>/.copilot/tracepilot/index.db'

[general]
setupComplete = true
autoIndexOnLaunch = true

[ui]
checkForUpdates = false
```

All other top-level config sections have serde defaults. An empty profile should
prefer the real setup flow when testing setup rather than pre-setting completion.
Changing roots can copy fixture data, so retain a manifest of generated resources.

This is **not a credential sandbox**. Native OS credential stores, inherited
environment credentials, `APPDATA`, GitHub CLI credentials, installed Copilot
executables and network access may still be available. Tauri plugin logs may
remain in the normal native logging location. Do not test sending prompts,
starting inference, publishing, remote writes or deleting existing resources on
the assumption that changing Windows home makes these harmless.

## Real backend session fixtures

`scripts/e2e/copilot-compat.mjs` is an existing example of creating a real
filesystem session in the configured session root, replaying it through the Rust
parser/index and UI, and cleaning up only the created UUID child directory. It
does not mock IPC. Its input is the repository-owned, sanitized
`crates/tracepilot-core/tests/fixtures/versions/v1_0_83_multiturn.jsonl`.

For audit fixtures:

1. Make each session a new, uniquely generated UUID directory. Discovery ignores
   non-UUID directory names (`session/discovery.rs`). Fail if a directory already
   exists; identify generated content as an audit fixture in its title.
2. Place JSON events in `events.jsonl` and metadata in `workspace.yaml`. Adjust
   timestamps consistently and session-start IDs to the generated session UUID.
3. `workspace.yaml` requires `id`; other fields are optional. Real metadata fields
   are `name`, `user_named`, legacy `summary`, `cwd`, `git_root`, `repository`,
   `branch`, `host_type`, `summary_count`, `created_at`, `updated_at`.
   `name` takes precedence over `summary`, with blank values treated as absent.
4. Use new task-owned repository directories for `cwd` and `git_root`. Rendering
   an arbitrary path is safe; launcher/editor/injection controls can write there.
5. Reindex/refresh through the app, verify the rendered title and conversation,
   and verify persistence or file changes for the workflow under inspection.
6. Return to the session list before cleanup. Verify resolved absolute cleanup
   targets remain direct children of the intended fixture root. Do not delete
   sessions that are not present in the audit manifest.

Useful existing fixture sources are `crates/tracepilot-core/tests/fixtures/versions/`
for versioned events and subagent lifecycle, `tracepilot-core/src/testing.rs` for
minimal raw events, and `tracepilot-bench/src/builder.rs` for large datasets.
`packages/test-utils/src/builders.ts` contains frontend model builders only;
those models do not establish that persisted session input is valid.

Long names and paths, Unicode, missing optional metadata, empty sessions,
multiple repositories/models, tool failures and larger lists can be represented
in local fixture files without invoking Copilot. Active states can use recent
fixture lock files and append-only lifecycle events, as demonstrated by the
compatibility replay. Record these as generated sessions parsed by the real
backend, not as authentic Copilot inference runs.

## Feature flags and external constraints

`config/features.rs` defines the exact flags below. Enabling a flag is sufficient
to expose its UI, but does not prove service availability or authorize remote
effects.

| Config key | Default | Audit implication |
| --- | --- | --- |
| `exportView` | false | Exercise local export only to disposable outputs |
| `sessionReplay` | false | Local replay UI can use generated event timelines |
| `renderMarkdown` | true | Compare plain and rendered fixture content |
| `mcpServers` | false | Edit only disposable MCP config; external startup is separate |
| `skills` | true | Local skill CRUD needs task-owned global/repository targets |
| `copilotSdk` | false | Disabled/disconnected UI is available; actual SDK/auth/runtime may not be |
| `exactContextCapture` | false | Capture invokes Copilot machinery; do not assume cost-free operation |
| `configInjector` | false | Preview/local injection must target disposable repositories |

Git/Copilot dependency checks execute CLI version commands. GitHub authentication
uses `gh auth status`; remote imports use `gh api` and require both tooling and
authentication. SDK connection, session creation, resumption and message sending
are separate commands. Read-only status is not evidence that send/resume works,
and fixture event rendering is not evidence of native SDK inference behavior.

Leave unavailable credential, network, OS-dialog, display-scaling and live SDK
scenarios as explicit coverage limitations with the exact observed cause.

## Generated audit corpus

`node scripts/e2e/usability-fixtures.mjs` generated 74 UUID session directories in
the ignored `.tracepilot/usability-audit-home/.copilot/session-state` root. The
ignored `fixture-manifest.json` at the profile root records each created ID,
scenario, title, model and event count. Re-running the generator returns that
manifest without replacing fixtures or removing anything.

The corpus includes 64 list sessions across three repository labels and four
models; long Unicode titles; optional metadata missing; an empty session;
events without workspace metadata; an unknown-pricing model; a tool failure
followed by successful operations; a 140-turn/842-event conversation; a recent
fixture active lock; and sanitized Copilot 1.0.24 and 1.0.83 lifecycle fixtures.
The rich lifecycle session includes a plan, three checkpoint entries (one with
deliberately unavailable content), four SQLite todos with two dependencies,
and a 120-row custom metrics table containing nulls and Unicode text.

The generator also initialized a disposable local Git repository at
`.tracepilot/usability-audit-home/repositories/audit-demo`, with a committed
README, status source file, repository instruction file and local audit skill.
It configures an invalid-domain fixture identity, disables commit signing and
hooks for generation, and creates no remote. It neither changes TracePilot
configuration nor opens the app nor executes Copilot.

Execution checks: Node syntax and Biome checks passed; a second generator run
reused all 74 existing sessions; the disposable Git working tree was clean.
The initial sandboxed run could not spawn Git (`EPERM`) before creating sessions.
Only its verified task-owned partial repository and manifest were removed, then
the authorized generation succeeded with elevated process execution. SQLite
was available through Node 22's experimental built-in module. Live parsing and
UI verification belong to the main audit and are recorded in the coverage matrix.

## Later native fixture checkpoint

The live owner subsequently verified the isolated profile and executed the bounded workflows recorded in [surface-coverage.md](surface-coverage.md). Add-only viewer enrichment created eight assets without replacing existing ones; three generator tests passed and original manifest/session hashes stayed unchanged. Native D now covers JSONL/CSV filtering with Unicode, no-match/reset, invalid JSON raw fallback, PNG dimensions/zoom/Fit and binary guidance. JSON after images were inspected at D/M/L, but the M key lies below the viewport. Unvisited formats and controls remain unverified.

A synthetic JSON export was produced and loaded into native Import, which rejected its own archive hash (UX-041). The corrected parser subsequently validates the same original archive and shows the Rust preview at D; Import was canceled without changes. The picker gateway forwarded native calls and restored itself, but actual OS-dialog interaction remains unverified. No successful persisted import is claimed. The existing writer's custom-table reconstruction limitation remains deferred. The user deferred deeper Import exploration, alongside deeper MCP, Worktrees and Launcher workflows; correcting and rechecking already validated defects remains active. This prioritization does not authorize replacing existing sessions or invoking remote services.

Later bounded Skills recovery created only audit-create-recovery in the isolated profile after a duplicate audit-imported attempt. The corrected description and name were verified in the editor and the 100-byte SKILL.md; no existing user skill was replaced. Deeper Compare/Replay exploration is also user-deferred, while already validated keyboard/date/create corrections retain their explicit verification status.

The initial Config Injector check showed empty/default tabs without saves/backups. Later owned fixtures populate the four tabs as recorded below; no existing user configuration was used for mutation. Two disposable in-app alerts were marked read, dismissed and cleared with the keyboard; the empty drawer reopened and Escape restored trigger focus. No actual session-alert navigation or OS notification delivery was exercised. The user later deferred deeper Alerts and requested the feature OFF.

SDK testing enabled `copilotSdk` only in the owned profile after confirming its settings record was absent, and verified unused loopback65534 before reproducing UX-048/049. Owned Stdio metadata/diagnostics succeeded with CLI 1.0.83/authentication/14models/zero tracked sessions. No linking/resumption/send/inference occurred; auto-connect preference timing remains an unvalidated lead. At the user's subsequent direction, the owned empty Stdio bridge was disconnected and SDK/Replay/Enable alerts switched OFF at M. All three visible states are false; SDK/Replay TOMLfalse and removal of the originally absent tracepilot:sdk-settings record are verified. Alerts TOML [alerts].enabled=false is now verified. Do not connect to or stop discovered existing UI servers merely to exercise controls.

SDK diagnostics performs discovery, connection, auth/model/tracked-session/status reads; its source contains no create/resume/send call. Stdio connection can spawn a private CLI subprocess and access logged-in-user metadata. Blank TCP Connect can automatically attach to a sole discovered real server, so it was avoided in favor of explicit unused loopback. The profile is not a credential sandbox. Native Stdio startup also changed owned settings from the fixture's Luna model to gpt4.1 and altered managed fields. Exact settings.json/config.json manifest contents were subsequently restored with both hashes matching, removing those CLI-startup changes; SDK flag/localStorage cleanup is also complete.

The MCP argument-preservation review test temporarily supplied one embedded-newline argument in an owned server configuration. Description-only Save split the original two arguments into three; the two-argument array was restored immediately. The follow-up passes 32 tests/typecheck and native M readonly/helper/Description-save checks; actual Rust-written JSON preserves the exact two arguments including the newline. The root inspected `mcp-multiline-after-M.png`. The full original backup `.tracepilot/audit-validation/mcp-before-multiline.json` was restored, and reload/Edit confirms the original comma/internal-space arguments remain editable. The final native M CR-array check also preserves exactly first\rsecond plus --label=two words after Description-only Save; the associated 12px helper and mcp-cr-preservation-after-M.png are inspected. The full original backup hash is restored. Existing user MCP resources were not changed.

Native M snapshot preflight now runs in the disposable home: CLI 1.0.83 ready, three protocols/default OpenAI Responses and Save OFF. Capture request shows nine-stage progress then a recoverable isolated CLI exited before sending a model request (exit1). An initial HMR interruption is distinct from the later stable failure. A fresh retry/Cancel capture Enter reports Capture cancelled and restores the editable form; Back to snapshots shows empty guidance. Fifteen source-file hashes remain unchanged, scratch0/saved0. Inspected preflight/progress/error images remain private. Later compatible-fixture native capture/save/reload/delete passes with inspected actual request content; the earlier fixture exit1 is preserved as a failure-state observation.

Twelve config-only files under `.tracepilot/usability-audit-home/config-injector-fixture-manifest.json` populate native M tabs with two agents/two versions/two backups; markers are not executables. UX-053/054 after Save/reloadtrue→falseSave preserves auditPreserveMe/disabledSkills, with native names/disclosure/diff checks and66 tests/typecheck/independent 33-test review. Only a new owned Unicode-label backup was created, previewed and deleted through two-step confirmation, returning the list2→3→2; no existing user backup was deleted. Same-version/different-version diff controls were exercised without migration execution. Restoring an owned false backup writes false to disk but leaves stale true/Save/diff in the editor (UX-057); ordinary/route re-entry after now passes with final77 tests/typecheck/independent 41-test review. Original settings.json/config.json manifest contents are restored with matching hashes.

Native Explorer name/content search reads the owned fixture corpus through Rust, including the café line-5 result. No clipboard write or external-folder action was invoked when reproducing the file-context-menu defect. New captures remain local and ignored until separately reviewed for publication.

SDK native after verifies accurate unused-loopback failure/retry, Advanced disclosure/field names and Warn→Info restoration; owned Stdio metadata/diagnostics succeeds. D/L controls are inspected with no outer overflow; account-bearing captures remain private. UX-052's first revisit hit the actual frontend HMR provider-key exception. After stable SDK/MCP keys and a clean native restart, both render normally with zero current console errors; native M model picker exposes 15 menuitemradios and End/Home/Escape exact-trigger focus passes in the inspected populated after image. No model selection, Link Session, resume, send or inference occurred. The owned empty bridge was disconnected, SDK OFF and originally absent tracepilot:sdk-settings record restored. Deeper SDK/Alerts/Replay work remains user-deferred; full live HMR mutation remains unverified.

Native SQLite table/schema/full-cell checks read only the owned audit_metrics fixture. UX-051 native D after now passes keyboard Unicode expansion/Escape restoration, cell navigation and180→196→180 resize, with inspected after evidence. SVG Plain Text406B matches Rust's unknown-extension Text fallback; it is not a supported Image extension. Neither SQLite nor SDK model-picker exploration changed the clipboard; Explorer menu after navigation/dismissal also invoked no clipboard/external-folder action.

Skills lifecycle touched only audit-lifecycle-disposable. The original109B/defective211B states are preserved in before evidence; corrected H1/Unicode bullet and metadata hint/tools/automatic OFF were subsequently saved and verified after reload. Owned0B reference-café.md had settled empty preview/Escape focus, then Remove Cancel/confirm verified disk deletion. Disable/reload/reenable restored disabledSkills[]; search/no-match/scope reset and Delete Skill Cancel/Escape/confirm finished with the owned skill deleted and five globals remaining. UX-055/056 D/M/L after images and independent 55-test/typecheck/review pass. No existing user skill was edited or deleted.

SQLite M/L keyboard and Explorer D/L menu/binary-M checks read only owned fixtures; no clipboard/external-folder action was invoked. UX-057 ordinary and immediate route re-entry native restore passes UI/diskfalse/Save disabled/diff0. The verification backup was deleted through two-step UI, leaving baseline two backups. Final77 mocked Config tests/typecheck and independent 41-test review cover re-entry plus the unrelated Save guard without real writes. Exact original settings.json/config.json manifest contents are restored with matching hashes; the owned agent model was restored after autosave/reload checks. Alerts TOMLfalse is verified.

Successful native capture uses a distinct compatible temporary session, preserving the original rich fixture. View once leaves no saved record; Save ON/reload/open then Delete Cancel/Escape/confirm returns disk0. The request is plaintext and captures remain private. Save OFF restored;15 source hashes unchanged/scratch0/saved0, then only the exact owner/path-checked temporary folder was removed. Actual CLI JSON D/M/L screenshots are inspected; no inference about publication permission follows. Settings rendering/Hide empty/theme/scale tests restored ON/ON/Dark100% respectively.

The final shallow Worktree check uses Discover from Sessions to register only the owned audit-demo fixture. Native M table/sort/Details reads its actual Rust data, then Remove repository removes only that new registration, returning zero repositories/rows; no repository files are deleted or altered. Final Export keyboard selection/preview uses owned AUDIT FIXTURE data without saving a new output. Palette and Command Centre checks are navigation-only. Replay remains OFF; a further D image is explicitly deferred under the user's latest direction.

UX-004 final verification uses a separate `.tracepilot/usability-empty-home` with an ownership marker and zero existing sessions. The owned populated WebView was stopped/preserved before running the fresh profile; setup Skip, empty guidance, Open Settings Enter/pointer, return/reload and D/M/L containment were checked. After stopping the empty app, the populated profile was restored. Its closed config.toml/index.db/repo-registry.json hashes remained unchanged and startup verified real Rust IPC. No existing profile was reset for this final check. The final Export no-match/Escape and pointer Recovery selection only changed transient selection and read the Rust preview.

Final app restoration is the populated profile at D1440×960, Dark/100%, Sessions with 73 visible items and empty search. SDK/Replay/Alerts remain OFF in TOML; the owned SDK bridge is disconnected and the originally absent SDK settings record remains absent. Current console counts are zero errors/three warnings. Temporary owned profile directories and private captures remain local; no existing user session, skill, repository or configuration was deleted for the audit.
