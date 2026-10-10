# Claude Code Sessions

TracePilot can index and view sessions from the Claude Code CLI alongside your
Copilot CLI sessions. The integration is **experimental** and off by default.
Copilot remains TracePilot's main source, so Copilot-only tools stay
Copilot-only.

TracePilot only reads Claude Code's files. It never creates, changes or
deletes anything in the Claude Code folder. Everything it derives (the index,
search and analytics) lives in TracePilot's own data folder.

Where each file lives and when TracePilot opens it is listed in
[on-disk paths](on-disk-paths.md#claude-code-experimental).

## Turn it on

First-run setup offers an optional **Also index Claude Code sessions
(experimental)** switch on the Copilot home step when the default Claude Code
folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`) holds sessions. It is off by
default, and **Skip setup** leaves it off. Otherwise, or to change it later:

1. Open **Settings → Claude Code** and turn on **Claude Code sessions**.
2. In the same section, check **Claude Code folder**. It is
   Claude Code's config folder, the one that holds `projects/`. It defaults to
   `CLAUDE_CONFIG_DIR`, else `~/.claude`. It must be an existing local folder;
   network shares are refused. Click **Apply** after changing it.

Turning the setting on indexes Claude Code sessions only, so Copilot sessions
are not re-indexed. Once both sources have sessions, the session list shows a
source badge and a source filter, and the Analytics pages get an
**All / Copilot / Claude Code** filter. Search gets the same filter beside its
sort menu; typing `source:claude` or `source:copilot` in the search box does
the same, and the filter counts follow it.

Turning the setting off removes Claude Code sessions from TracePilot's index,
search and analytics, and leaves your Claude Code files alone. Turning it back
on rebuilds them. Changing the folder works the same way: the old folder's
sessions are removed and the new folder is indexed.

## What works

| Area | Claude Code sessions |
| --- | --- |
| Session list, search, Conversation, Events, Timeline | Yes. Session titles follow `/rename`. |
| Subagents | Yes. Their transcripts are folded into the parent session, like Copilot's subagents. |
| Metrics | Exact token and cache totals per model. Cost is an estimate (see [Costs](#costs-are-estimates)). |
| Context | Total input per model call. Claude Code doesn't record a system, tools and conversation split. |
| Prompt cache | Observed cache reads and writes per call. Expiry is estimated from each request's recorded cache lifetime (5 minutes or 1 hour), and shows as unknown when none was recorded. |
| Overview | The session plan and file-history checkpoints (below). |
| Explorer | The session's `subagents/` and `tool-results/` folders. |
| Export | Markdown and JSON, marked with the source. On top of the redaction options you pick, TracePilot always removes account details (email, organization and account IDs, quota limits) and the system-prompt and instruction-file attachments from the native records. |
| Import | No. Import writes Copilot session folders. |
| Resume | **Resume in Terminal** opens a terminal in the session's working directory and runs `claude --resume <id>`. **Copy Resume Command** copies the same command; run it from that directory. Set the command (for example `npx claude`) under **Settings → Claude Code → Claude Code command**. Exact context capture stays Copilot-only. |
| Analytics, Tool Analysis, Models, Session Comparison | Yes. Costs in different units are never added together: the dashboard shows **Cost by Source** when both sources are present, and comparisons across sources show no cost delta. |

### Not supported

- **Todos.** Claude Code's task tools are off by default on current models, so
  Claude sessions have no Todos tab. Task tool calls from older or opted-in
  sessions show as generic tool calls.
- **Copilot-only features:** launching sessions, SDK
  steering and live attach, the config injector, the MCP, skills and agents
  editors, exact context capture and CLI version management.
- **Alerts and notifications** for Claude Code sessions.
- **Reasoning text** that Claude Code didn't save. Most thinking blocks are
  stored as a signature only, so there is nothing to show.
- **The Node CLI** (`apps/cli`) reads Copilot sessions only.

## History follows Claude Code's cleanup

Claude Code deletes transcripts older than its `cleanupPeriodDays` setting,
which defaults to 30 days. TracePilot doesn't keep a copy. When a transcript is
deleted, its session leaves TracePilot's index the next time sessions are
indexed, just like a deleted Copilot session. Analytics for Claude Code
therefore cover roughly your last 30 days.

The index is not a backup. To keep more history, raise `cleanupPeriodDays` in
Claude Code's settings. That can't bring back transcripts already deleted.

## Costs are estimates

Claude Code sessions are priced in **API-equivalent US dollars**, an estimate
and not a bill. It is the same yardstick whether you use a subscription or an
API key. It doesn't show how much of a subscription allowance you used.

The Metrics tab labels each figure with its basis:

- **Claude Code estimate:** the cost Claude Code recorded in the session's last
  cost snapshot.
- **TracePilot estimate:** TracePilot priced calls made after the last snapshot,
  or calls in a session with no snapshot, at Anthropic's API rates. Cache
  writes are priced at their recorded 5-minute or 1-hour rate.
- **Partial:** the session has calls after its last snapshot, or no snapshot
  yet (usually because it is still running), so the total may grow.

Session totals can be larger than the sum of the turns. Claude Code's totals
include side models and work such as compaction that never appear as turns.
Subagent usage is already included, so don't add it again.

## Prompt cache timing

Claude Code records whether each request read or wrote the prompt cache, and
whether a write used the 5-minute or 1-hour lifetime. Which lifetime it asks for
depends on your plan and settings, and subagents usually use the shorter one
(see Claude Code's
[prompt caching docs](https://code.claude.com/docs/en/prompt-caching)).
TracePilot counts the lifetime from the start of the last request that used the
cache, so its expiry time is an estimate: a long answer or tool run uses up part
of a 5-minute window. A subagent builds its own cache, so a warm parent doesn't
mean a warm subagent.

## Live running state

A running Claude Code session shows the same running indicator as Copilot in
the session list and detail header. Where Claude Code records it, the badge
reads **Busy** (Claude Code is working) or **Waiting** (it is waiting for
input; the process is still running).

TracePilot reads Claude Code's process files in `sessions/` and checks that the
process they name is still running with the recorded start time. A file left
behind by a crash therefore doesn't keep a session running, although a crashed
process can still read as running for up to 5 seconds.

While a session runs, its detail view refreshes every 3 seconds. Refreshing
pauses while the window is hidden and stops once the session goes idle.

Running state is available on Windows, macOS and Linux. The start time is read
through Win32 on Windows, `ps` on macOS and `/proc` on Linux.

## Background work

Background work settles on the tool call that started it, in the
Conversation:

- A **background subagent** card gets its status, tokens and duration when the
  subagent finishes, like Copilot's.
- A **background shell** (`run_in_background`, or a command Claude Code moved
  to the background) shows its final state on the command's card, for example
  **Background · Completed · exit 0 · 2m**, once Claude Code reports it. The
  command's own row still shows that the launch succeeded. A shell that never
  reported keeps the plain *background* label. Copilot's background, detached
  and still-running shells settle the same way.
- Background command output lives in your system's temporary folder. TracePilot
  never reads it, and the files may already be gone.

## Plans and checkpoints (read-only)

- **Session Plan** on the Overview tab shows the latest plan from plan mode.
  If the transcript recorded no plan text, TracePilot falls back to the plan
  file Claude Code keeps in `plans/`.
- **Checkpoints** on the Overview tab lists one checkpoint per prompt, from
  Claude Code's file history. Each checkpoint shows the files tracked so far,
  which ones changed since the previous checkpoint, and which did not exist
  yet. **View** opens the backed-up version of a file. TracePilot reads that
  backup only when you click **View**, shows the first 1 MiB, and doesn't
  preview binary files.

There is no restore button. To rewind, use Claude Code itself.

## Format diagnostics

Claude Code changes its transcript format often. **Settings → Claude Code →
Claude Code format diagnostics** lists:

- record and attachment types TracePilot doesn't map yet;
- the Claude Code versions that wrote your sessions;
- for each, the number of sessions and records.

The counts are collected while indexing, so opening the panel doesn't re-read
anything. Use **Refresh** after indexing new sessions. The panel holds names
and counts only, with no paths, IDs or content.

## Troubleshooting

### No Claude Code sessions appear

- Check that **Settings → Claude Code → Claude Code sessions** is on.
- Check **Settings → Claude Code → Claude Code folder**. It must be the
  folder that contains `projects/`. TracePilot saves the default when it first
  creates its settings. If you set `CLAUDE_CONFIG_DIR` later, or run Claude
  Code with a different `CLAUDE_CONFIG_DIR`, enter that folder here. TracePilot
  reads one Claude Code folder at a time.
- The folder must exist and be on a local drive. Network shares are refused.
- If the folder goes missing (for example, an unplugged drive), indexing that
  source fails instead of treating it as empty, so sessions already indexed
  are kept.
- Sessions older than Claude Code's cleanup period have been deleted by Claude
  Code (see [above](#history-follows-claude-codes-cleanup)).
- If the session list says empty sessions are hidden, choose to show them.
- New sessions appear when the list refreshes. Use the refresh button above
  the list, or turn on auto-refresh.

### A session never shows as running

The Claude Code process must still be running, and its file in `sessions/`
must name this session.

### Reporting a format problem

If a Claude Code update breaks a view, open an issue with the **Claude Code
format diagnostics** table from Settings, or the census report:

```sh
node scripts/claude-census.mjs [claude-config-folder]
```

The census runs from a TracePilot checkout and needs the Rust toolchain. The
folder defaults to `CLAUDE_CONFIG_DIR`, else `~/.claude`. It reads only
`projects/**/*.jsonl` and their `subagents/` folders, never `sessions/`, and
prints a Markdown report of unmapped types and versions with their counts.
Anything that doesn't look like a type name or version is counted as
`(unrecognized name)` or `(unrecognized version)`.

**Safe to paste:** the census report, the diagnostics table, your Claude Code
and TracePilot versions, and your operating system.

**Never paste:** transcripts (`*.jsonl`), files from `tool-results/`,
`file-history/` or `plans/`, anything from `sessions/` (each `.key` file there
is a secret), or screenshots of conversations. Transcripts contain prompts,
tool output, file contents and account details.
