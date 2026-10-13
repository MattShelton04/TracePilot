# Claude Code's temp folder: contents, lifetime, and what TracePilot could show

> **Status:** Research only. Nothing here is implemented.
> **Date:** 2026-10-13
> **Builds on:** [README](README.md), [mapping.md](mapping.md) and the path table in
> [on-disk-paths.md](../../on-disk-paths.md). Today that table lists the system temp folder as
> "never read".
> **Evidence:** A read-only scan of one Windows machine's `%TEMP%\claude`:
> - 13.6 GB in 24,864 files, across 22 project folders and 260 session folders.
> - Claude Code 2.1.293 → 2.1.295, CLI and desktop app (`entrypoint: claude-desktop`).
> - Cross-checked against the same machine's `~/.claude/projects` transcripts.
>
> Nothing was modified.

## 1. Answers in brief

**What is in it?** Per-session working files that Claude Code keeps outside `~/.claude`:
- Background command output.
- The agent's scratchpad, where it saves scripts, screenshots, logs, reports and sometimes whole
  build folders.
- Copies of pasted images.
- For desktop-app sessions, a snapshot of the request configuration.

There are also a few machine-wide working folders.

**Which of it is new information?** Only some:
- **New:** background command output, scratchpad files, and the desktop app's
  request-configuration snapshot.
- **Already in `~/.claude`:** subagent output files (hard links to, or empty placeholders for,
  `subagents/agent-*.jsonl`) and pasted images (inline in the transcript).

**Is it cleaned up?** Yes, and quickly. About **7 days after a session's last activity**, its
temp files are deleted. The sweeps look roughly daily, at irregular times. Folder skeletons and
read-only files are left behind (§4).

This is much shorter than transcript retention (`cleanupPeriodDays`, which TracePilot offers to
raise). So anything TracePilot shows from this folder is a **best-effort window on recent
sessions**. It can never be relied on.

**Where would it fit?** Ranked by value for the effort, all read **on demand**, never by the
indexer:

| # | Data | Where it would show |
| --- | --- | --- |
| 1 | Background command output | The background shell's card and the notification card in the Conversation |
| 2 | Pasted images | Prompts. Render from the transcript itself; the temp folder is not needed (§5.2) |
| 3 | Scratchpad | A third root in the Explorer tab, plus "open" links from tool calls that touched it |
| 4 | Desktop request configuration | A small "Session setup" panel on Overview: tools, MCP servers, modes. Lower priority, and the format is undocumented |

## 2. Where the folder is

The location is documented under `CLAUDE_CODE_TMPDIR` in Claude Code's
[environment variables](https://code.claude.com/docs/en/env-vars.md) and
[`.claude` directory](https://code.claude.com/docs/en/claude-directory.md) pages.

- **Windows:** `%TEMP%\claude\`, or `<CLAUDE_CODE_TMPDIR>\claude\`.
- **macOS and Linux:** `/tmp/claude-<uid>/`, or `<CLAUDE_CODE_TMPDIR>/claude-<uid>/`.
- `CLAUDE_CODE_TMPDIR` is honored only from the shell, user settings or managed settings, not
  from project settings.

`<project>` below is the same slug as `~/.claude/projects/<project>`: the working directory
with non-alphanumerics replaced by `-`. `<session>` is the session UUID. A session's temp
folder can therefore be found from the transcript TracePilot already has.

The transcript also records absolute paths into this folder:
- `<output-file>` in `<task-notification>`.
- `outputFilePath` on `task_status` attachments.
- "Output is being written to: …" in background Bash results.
- `[Image: source: …]` beside pasted images.
- Plenty of scratchpad paths in tool inputs.

## 3. What it contains

| Path | Written by | Contents | Observed | New information? |
| --- | --- | --- | --- | --- |
| `<project>/<session>/tasks/b<id>.output` | Background Bash/PowerShell (`run_in_background`, or a command moved to the background) | The command's combined stdout/stderr, then a trailer line: `[exited with code N]` or `[killed]` | 667 files, 0.6 MB in total. p50 177 B, p99 7 KB, max 26 KB | **Yes.** The transcript has only the notification summary ("completed (exit code 0)"), unless the agent later `Read` the file |
| `<project>/<session>/tasks/a<id>.output` | Agent (subagent) tool | The subagent's JSONL transcript | 121 files: 32 are **hard links** to `projects/<project>/<session>/subagents/agent-<id>.jsonl`, 89 are **empty** placeholders whose link was replaced | No. TracePilot already parses `subagents/` |
| `<project>/<session>/scratchpad/` | The agent, told to use it for temporary files | Anything: Python/JS/shell scripts, Playwright screenshots, logs, Markdown reports, JSON dumps, copied source trees, `.bak` files, whole Cargo target folders | 257 session folders, 48 not empty. One scratchpad was 10.9 GB (a 9.5 GB Cargo target), others up to 1.4 GB. 411 PNGs, 150 `.py`, 95 `.log`, 61 `.md` | **Yes.** Only files the agent `Write`s are in the transcript (as tool input). Command output, screenshots and builds are not |
| `<project>/<session>/images/<n>.png` | Prompt image paste | The pasted image, numbered as `imagePasteIds` | 6 files in 4 sessions | No. The same image is inline base64 in the user record (§5.2) |
| `cache-break-state-<session>.json` | Desktop-app sessions only (the `sdk` key) | The last request's configuration and hashes, overwritten on every API call (§3.1) | 25 files of 5–13 KB. Every desktop-app session active in the past week has one; CLI sessions have none | **Partly.** The tool list, auto mode, fast mode, thinking settings, betas and system-prompt size are not in the transcript |
| `bash-edit-diff/<hash>-<hash>-<hash>/` | Claude Code, around shell commands | A shadow git index of the working tree (`index`, `objects`, `info/exclude`, one "snapshot" commit), apparently used to work out which files a shell command changed | 5 folders, all from the last hour, about the number of busy sessions | No. Not keyed by session id, and gone within the hour |
| `bundled-skills/<version>/<hash>/<skill>/` | Claude Code | Built-in skills unpacked for the running version (here `dataviz`) | One version (2.1.295) | No |
| `<project>/` folders with only empty `<session>/scratchpad/` | Sessions that wrote no transcript | Nothing | 104 under the home-folder slug, 9 `…-claude-sandbox-status-<rand>` probe folders, and about 75 under real projects | No. These look like helper or probe processes and are not real sessions |

Claude Code documents the scratchpad, `images/` and the location variable. It does **not**
document `tasks/`, `bash-edit-diff/`, `bundled-skills/` or `cache-break-state-*.json`, so treat
their formats as unstable.

### 3.1 `cache-break-state-<session>.json`

This is one object keyed by query source. Only `sdk` was seen, because every file came from the
desktop app. Fields worth knowing:

| Field | Example | Meaning |
| --- | --- | --- |
| `model`, `effortValue`, `fastMode` | `claude-opus-5-5`, `high`, `false` | Model settings on the last call |
| `thinkingMode`, `thinkingDisplay` | `on`, `omitted` | Extended thinking settings |
| `autoModeActive`, `isUsingOverage` | `true`, `false` | Permission mode and billing state |
| `is1hCacheTTL`, `globalCacheStrategy` | `true`, `none` | Prompt-cache TTL choice |
| `toolNames` | 49 names | The tools offered on the last call, including every `mcp__<server>__<tool>`. This gives the MCP servers connected |
| `anyDeferLoading` | `true` | Some tools were deferred (ToolSearch) |
| `betas` | 13 strings | API beta flags |
| `systemCharCount` | 12,869 | System prompt size |
| `callCount`, `queryDepth` | 186, 185 | API calls in this process; nesting depth |
| `prevCacheReadTokens` | 383,401 | Cache read on the previous call |
| `buildVersion` | `2.1.295` | Claude Code version |
| `systemHash`, `toolsHash`, `perToolHashes`, `messageHashes`, `sysFoldShape`, … | integers | Fingerprints Claude Code compares between calls to explain a prompt-cache miss. With only the last snapshot, TracePilot cannot diff them |

## 4. Automated cleanup

**What happens.** A session's temp files are deleted about **7 days after its last activity**.
The evidence:

- **All pre-October temp folders are gone.** 27 transcripts last active before 2026-10-01
  reference their temp folder, and none of those folders exists. Every session active since
  then that referenced its folder still has it.
- **The project folders are older than any surviving session folder.** The project folders were
  created 2026-09-17 to 09-19, yet the oldest session folder inside them is from 2026-09-30. So
  the removal was selective; the folder was not wiped.
- **The delay is consistent.** For each session last active between 2026-10-01 and 10-05, the
  folder's last change (the deletion) came **7.0 to 8.3 days** after the transcript's last
  write. The sweeps landed at 10-08 18:02, 10-09 10:03, 10-10 03:11, 10-11 10:31, 10-12 21:06 and
  10-13 02:00: roughly daily, at irregular hours. None lines up with a session starting.
- **Files are deleted, folders are not.** Swept sessions keep an empty skeleton (`scratchpad/`,
  `tasks/`, nested empty folders).
- **Some files survive.** The only temp files older than 7 days are 15 read-only `.git/objects`
  files and 2 files from a nested git checkout in two scratchpads. The sweep apparently skips
  files it cannot delete.
- **The rule looks like file age, not modification time.** A scratchpad with files dated 2006
  (mtimes kept when copied in on 10-09) is untouched, so the rule is likely based on creation
  time or session activity.
- **Everything else fits the same window.** The oldest `cache-break-state-*.json` is 4 days old,
  and `bundled-skills/` keeps only the current version.

**Windows is not doing it.**
- Storage Sense is on, set to delete unused temp files, but it runs only when disk space is low.
  It last triggered on 2026-08-10.
- The `SilentCleanup` scheduled task last ran on 2026-10-13 and did nothing (result
  `0x800710E0`, conditions not met).
- Windows does not clear `%TEMP%` on reboot.

So the sweep is Claude Code's own, probably run periodically by long-lived Claude Code
processes. The desktop app keeps several running.

**This differs from the documentation.** The
[`.claude` directory page](https://code.claude.com/docs/en/claude-directory.md) says the
scratchpad and images are removed together with the transcript, after `cleanupPeriodDays`.
- On this machine `cleanupPeriodDays` is 3651, yet temp files go after about 7 days. Either the
  temp sweep has its own fixed window or the documentation is out of date.
- Raising `cleanupPeriodDays`, which TracePilot offers in Settings → Claude Code, does **not**
  keep temp files.
- On macOS, `/tmp` is also cleared on reboot.

**Growth between sweeps.** Within the 7 days a scratchpad can be very large: 10.9 GB in one
session here, mostly a Cargo target folder. Other Claude Code users have reported the temp folder
growing past 100 GB on versions without a sweep
([third-party mirror of issue #35164](https://claudeissues.com/issue/35164-claude-code-never-cleans-up-tmp-claude-uid-can-grow-to-100gb),
not verified on GitHub).

**What this means for TracePilot:**
- Every feature in §5 must treat the files as optional and say plainly when they have expired
  ("Claude Code clears temporary files about a week after a session").
- Never infer anything from a file being missing.
- Never walk a scratchpad recursively without limits.
- TracePilot keeps no copy of Claude Code data (D3 in [on-disk-paths.md](../../on-disk-paths.md)).
  Capturing background output into `index.db` before it expires would be a new product decision.
  It is listed as an open question (§7), not recommended here.

## 5. What we could show, and where

### 5.1 Background command output: recommended first

**What exists today:**
- Background shells settle on their launching call via `BackgroundOutcome`
  (`turns/reconstructor/background_shells.rs`).
- Wake-up notifications render as `TaskNotificationCard.vue`.
- The parser already carries `TaskNotification.outputFile` and the call's `shellId` (the
  background task id). The UI shows neither and never reads the file.

**Proposal:**
- **Show the output.** Add an **Output** expander to the background shell's card, and to each
  `shell_completed` row on the notification card. It shows the file's text, with the
  `[exited with code N]` / `[killed]` trailer shown as a status chip.
- **Read only when asked.** Read the file when the expander opens, over a new IPC command such as
  `get_session_task_output(sessionId, taskId)`.
- **Size limits.** The files are small (max 26 KB seen), so cap at, say, 1 MiB and show the tail.
- **Running tasks.** For a running session, re-read on the existing 3 s liveness poll while the
  task has no trailer. That shows live progress for long background commands such as CI waits,
  test runs and dev servers.
- **Missing files.** If the file is gone, show "Output no longer available (Claude Code clears
  temporary files about a week after a session)". Keep the summary from the notification.
- **Not searchable.** Do not index the output. Results would disappear after a week and make
  search behave inconsistently.

**Value.** This is the largest gap the folder fills. Background commands are common: 667 in a
week here. Today the Conversation shows only "Background · Completed · exit 0".

### 5.2 Pasted images: use the transcript, not the temp folder

- **Where they already are.** The image paste is stored twice: as `images/<n>.png` in the temp
  folder, and as inline base64 `image` blocks in the same user record (with `imagePasteIds`).
- **What TracePilot does today.** Its reader replaces all image payloads at read time
  (`reader.rs` `sanitize_images`), and the Conversation shows only the media type.
- **Proposal.** Rendering pasted images needs no temp access. Keep the payload, or its offset,
  for user-prompt images only, and serve it on demand.
- **Wider opportunity.** The same applies to **tool-result images**. One UI-heavy session here
  had about 100 inline screenshots, from `Read` on a PNG or browser screenshots. Showing them in
  the Conversation would be a separate, larger feature. It is independent of the temp folder and
  bounded by `reader.rs`'s line cap.

### 5.3 Scratchpad in the Explorer tab

- **Today.** `EXPLORER_DIRS` (`claude_code/provider.rs`) is `subagents` and `tool-results`. A
  third root, **Scratchpad (temporary)**, would expose the agent's working files: screenshots
  it took, scripts it ran, logs and reports.
- **Where the value is.** Most of this never reaches the transcript. For UI work in particular,
  the screenshots are the clearest record of what the agent saw.
- **Links from tool calls.** Tool calls whose arguments or output name a path inside the
  scratchpad (Write, Read, Bash `> file`, Playwright `--filename=`) could get an "Open in
  Explorer" link when the file still exists.
- **Constraints:**
  - Listing is lazy, one folder at a time, as in today's Explorer.
  - Show sizes but skip descending into very large folders (`target/`, `node_modules/`, `.git/`)
    unless the user opens them.
  - Never touch it from indexing or export.
- **A cheap extra.** A small Overview line could show the session's temp usage and when it
  expires ("Temporary files: 1.4 GB, cleared about 7 days after last activity"). It would help
  explain disk use.

### 5.4 Session setup from `cache-break-state` (desktop app only)

- **What it would show.** A **Session setup** panel on Overview, or near the model and effort in
  the Context tab:
  - Tools available on the latest call, grouped into built-in tools and MCP servers.
  - Whether tools were deferred.
  - Auto mode, fast mode, thinking mode and display, overage, cache TTL and system-prompt size.
- **Why it ranks last:**
  - Only desktop-app sessions write it.
  - It is the latest state only (no history), and it expires with the rest.
  - It is an undocumented diagnostic file that could change in any release.
  - The hashes cannot be diffed with a single snapshot.
- **If built:**
  - Guard it with the existing format-drift diagnostics (`drift.rs`, `census.rs`).
  - Label it "as of the last request".
  - Hide it when the file is missing.

### 5.5 Not worth surfacing

| Item | Reason |
| --- | --- |
| `tasks/a<id>.output` | A hard link to, or an empty placeholder for, a subagent transcript TracePilot already reads |
| `bash-edit-diff/` | Ephemeral (under an hour), not keyed by session, and only a git index |
| `bundled-skills/` | Static copies of built-in skills |
| Empty probe and helper session folders | No transcript and no content |

## 6. Implementation notes, if this goes ahead

**Locating the root:**
- Use `CLAUDE_CODE_TMPDIR` from TracePilot's environment, else `std::env::temp_dir()`. Then
  append `claude` on Windows, or `claude-<uid>` on Unix.
- TracePilot runs as the same user, so this matches what Claude Code uses, except when the user
  set `CLAUDE_CODE_TMPDIR` in Claude Code's own `settings.json`. Reading that one key, as is
  already done for `cleanupPeriodDays`, would cover that case.
- An override in **Settings → Claude Code** (`sources.claudeCode.tempDir`) would cover the rest.
- Under `TRACEPILOT_DATA_ROOT` isolation, use `<data root>/claude-tmp` or disable the feature.
  Never fall back to the real temp folder.

**Path safety.** Follow the rules already used for `file-history/` and `plans/`:
- Build every path from the root, the session's own project slug and session id, and a
  validated task id (`b[a-z0-9]+`) or a relative Explorer path.
- **Never open a path recorded in the transcript.** Use recorded paths only to confirm that the
  derived path matches.
- Canonicalize, require containment in the session's temp folder, refuse reparse points and
  junctions that lead outside it, and cap read sizes.

**Read only on demand.** This is like `tool-results/`:
- Never read during discovery, indexing, search extraction or export.
- No new fingerprint inputs, so temp churn never invalidates the index.

**Capability.** Add a flag such as `has_temp_artifacts` on `SourceCapabilities`, and in
`packages/types/src/sources.ts`. That keeps a later Codex provider from inheriting UI that does
not apply to it.

**Docs to update when shipped:**
- The "System temp folder" row in [on-disk-paths.md](../../on-disk-paths.md).
- The "Background work" bullet in [claude-code-sessions.md](../../claude-code-sessions.md),
  which today says TracePilot never reads the output.
- The limitations in [mapping.md](mapping.md).

**Fixtures.** Synthetic `tasks/*.output` files (completed, killed, and running with no trailer)
and a small scratchpad tree, in `tracepilot-test-support`. Real temp content must never be
committed.

## 7. Open questions

1. **Keep background output past the sweep?** Should TracePilot snapshot it, small and capped,
   into `index.db` before it expires? This would break the "no copy" stance (D3). Background
   output is tiny, but it can contain secrets, which export redaction would then need to cover.
2. **What exactly does the sweep do?** Its trigger and rule are inferred, not documented. Should
   we file or track an upstream issue so the 7-day window, and its conflict with the
   `cleanupPeriodDays` documentation, is confirmed?
3. **Are tool-result screenshots in scope here?** §5.2 shows they are already in the transcript.
   They are probably a better first "rich media" feature than anything in the temp folder.
4. **Does macOS or Linux behave the same?** Is the sweep the same there, and does `/tmp` clearing
   on reboot make the window shorter in practice?
