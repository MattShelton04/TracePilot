# VS Code Session Support — Fresh Look

> **Status:** Research only; nothing implemented.
> **Date:** 2026-10-04
> **Replaces:** the conclusions of [the March study](vscode-session-support-feasibility.md). Its
> format notes for classic chat files are still accurate (§5).
> **Evidence:** VS Code 1.140.0 with Copilot Chat 0.68.0 on Windows. Local stores scanned
> read-only: `%APPDATA%\Code\User`, `%APPDATA%\Code\agentSessionData`, `~/.copilot`, `~/.codex`.

---

## 1. Verdict

**The March study asked the wrong question.** It treated "VS Code sessions" as the classic Copilot Chat files under `workspaceStorage/*/chatSessions/`. VS Code has since become a front end for several agent runtimes, and each runtime writes to its own store.

VS Code's Agents view caches 229 unique sessions on this machine:

| VS Code provider | Sessions | Transcript lives in | TracePilot today |
| --- | ---: | --- | --- |
| `copilotcli` (Copilot CLI background agent) | 114 | `~/.copilot/session-state/<id>/` | **Already indexed** |
| `agent-host-copilotcli` (new in-process agent host) | 3 | `~/.copilot/session-state/<sdkSessionId>/` + VS Code wrapper DB | **Indexed, with gaps** (§3) |
| `openai-codex` (Codex extension) | 92 | `~/.codex/` (`originator: codex_vscode`) | Not supported; the [Codex provider](codex-claude-code-session-support-feasibility.md) covers it |
| `copilot-cloud-agent` | 12 | GitHub (remote) | Not local |
| `vscode-chat-session` (classic local chat) | 8 | `workspaceStorage/*/chatSessions/` | Not supported |

Counted from the Copilot side instead, **377 of the 405 Copilot sessions with an event log (93%) were started from VS Code**; they carry `vscode.metadata.json`. Most of what TracePilot shows on this machine already comes from VS Code.

**Recommendation, by value per effort:**

1. **Fix VS Code-hosted Copilot sessions only where a gap is reported.** These sessions are already indexed in Copilot's format, so no new parser or provider abstraction is needed. Candidate fixes are in §3; the decision is in §6.
2. **Codex** (including VS Code's Codex extension). Effort is Medium–High; see the earlier report. It is the second-largest VS Code source here.
3. **Classic local chat parser.** Effort is Medium, but the value is low. Only 20 of 182 chat files contain a conversation, and the newest dates from April 2026. Do this only if users still rely on Ask/Edit/local agent mode.
4. **Cloud agent sessions.** Out of scope (remote data).

---

## 2. Storage map (VS Code 1.140)

```
%APPDATA%\Code\
├── User\
│   ├── globalStorage\
│   │   ├── state.vscdb                 ← agentSessions.* keys, chat.thinkingTitleCache, model caches
│   │   ├── agent-host.db               ← NEW: registry of agent-host sessions (sessions_v2: provider, payload JSON with project, git, changes, archived/read)
│   │   ├── agent-host-config.json      ← NEW: host settings (codexAgentEnabled, showExternalSessions, sandbox, …)
│   │   ├── agent-host-storage.json     ← NEW: catalog reconciliation cursors, recent session updates
│   │   └── github.copilot-chat\
│   │       ├── session-store.db        ← CLI-style session store schema v3; empty here
│   │       ├── copilotCli\copilot(.bat|.ps1)   ← CLI shim VS Code uses
│   │       └── plan-agent\, ask-agent\, explore-agent\   ← built-in agent definitions
│   └── workspaceStorage\<hash>\
│       ├── workspace.json              ← folder URI
│       ├── state.vscdb                 ← agentSessions.model.cache (per-workspace session list, all providers)
│       └── chatSessions\<id>.jsonl|.json   ← classic local chat (unchanged format, §5)
├── agentSessionData\                   ← NEW: one folder per agent-host session or chat
│   ├── <wrapperSessionId>\session.db   ← title, project, archived/read, per-turn usage, file edits, terminal output, git changeset
│   ├── default-<base64(copilotcli:/<id>)>\session.db   ← per-chat state; maps to sdkSessionId
│   └── <sdkSessionId>\session.db       ← "peerChatBacking" marker
└── agent-host\local-endpoint\entries\*.json   ← named-pipe endpoints of running hosts (pid, token)

~/.copilot/session-state/<sdkSessionId>/       ← the actual event log (events.jsonl, workspace.yaml, checkpoints/, inuse.<pid>.lock)
```

Paths on macOS and Linux are assumed to follow VS Code's usual user-data roots (`~/Library/Application Support/Code`, `~/.config/Code`). Only Windows was observed. Insiders, VSCodium and Cursor use their own roots; VS Code Insiders is not installed here.

### 2.1 Agent-host identity

An agent-host session has **two IDs**:

- **VS Code wrapper session** (`copilotcli:/a07afc72-…`). This is in `agent-host.db` and `agentSessionData/<id>/session.db`.
- **Copilot SDK session** (`31e9530d-…`). This is the folder in `~/.copilot/session-state`.

The link is `defaultChatProviderData = {"sdkSessionId": "…"}` in the wrapper's `session_metadata`. A wrapper can hold several chats (`peerChats`, `ahp-chat://` URIs), so **one VS Code session can map to several Copilot sessions**.

---

## 3. Why your VS Code session looks "not perfect" in TracePilot

Inspected example: VS Code session `a07afc72…`, Copilot SDK session `31e9530d…`, created 2026-10-04 by `client_name: vscode-agent-host`. These are evidence-based hypotheses; §7 asks which ones match what you saw.

| Symptom you'd likely see | Cause found on disk | Fix |
| --- | --- | --- |
| No AI Credits/cost, or partial token totals | No `session.shutdown` while VS Code's agent host keeps the session open. Per-request usage (`inputTokens`, `cacheReadTokens`, `totalNanoAiu`, `durationMs`, `timeToFirstTokenMs`, quota snapshot) is in **VS Code's** `agentSessionData/<wrapper>/session.db` → `turn_usage`, not in `events.jsonl` | Overlay `turn_usage` when no shutdown exists. Otherwise fall back to the `session.usage_checkpoint` totals already in the log |
| Shows as running long after it finished | `inuse.<pid>.lock`/`.hold` belong to the agent-host process (pid 19468), which outlives the chat | For `vscode-agent-host` sessions, combine the lock with VS Code's state (wrapper `isArchived`, `agent-host-storage.json` recent updates) or the event tail (`assistant.turn_end` + idle) |
| Version shows `0.0.0` / odd version analytics | `session.start.copilotVersion: "0.0.0"`, `producer: copilot-agent`. The SDK build embedded in VS Code doesn't report a CLI version | Treat `0.0.0` as unknown. Show "VS Code agent host" plus the Copilot Chat extension version instead |
| Archived in VS Code but still listed | Archive and read state live only in the wrapper (`isArchived = true` here) | Read the wrapper flags; add a "hide VS Code-archived" filter |
| Title differs from VS Code | VS Code uses deferred title generation (`titleGenerationStrategy: deferred`, `customTitle`, `customTitleSource`); TracePilot uses `workspace.yaml name` | Prefer the wrapper's `customTitle` when `customTitleSource` is user or generated |
| Extra hook noise in Events/Conversation | VS Code injects `userPromptSubmitted` and other hooks with `additionalContext`. Five pairs appeared in a one-turn session; older VS Code sessions average ~63 hook events each (23,939 across 377) | Collapse VS Code-injected hooks by default |
| No "VS Code" badge | `host_type: github` for every session. The origin is only in `client_name` (`vscode-agent-host`) or the presence of `vscode.metadata.json` (`origin: other`, `firstUserMessage` in newer ones) | Derive a `client` field at index time; add a badge and a list filter |
| "Changes" don't match VS Code's view | VS Code's changeset (`agentHost.changeset.*`, `diffs`) is computed against the **branch**. Here it included an unrelated uncommitted file | Keep TracePilot's own code-impact numbers; show VS Code's changeset only as a labelled extra, if at all |

The fixes are small and local:

- An origin classifier in summary or indexing.
- An optional wrapper reader. This is a read-only SQLite open of a file VS Code writes, following the same rules as the Codex `state_5.sqlite` overlay.
- UI badges and filters.

---

## 4. The older VS Code + Copilot CLI integration (already working)

Before the agent host, VS Code launched sessions through the regular Copilot CLI and dropped `vscode.metadata.json` into the session folder.

| Origin | Sessions with events | With `session.shutdown` | With `usage_checkpoint` |
| --- | ---: | ---: | ---: |
| VS Code (marker file) | 377 | 359 | 5 |
| Plain CLI | 27 | 25 | 20 |
| VS Code agent host | 1 | 0 | 1 |

Marker files date from March to August 2026, with the `origin: other` form appearing from April onward. These sessions render like any CLI session. The only gaps are the missing VS Code badge or filter and the hook noise.

---

## 5. Classic local chat (`chatSessions/`) — what changed since March

Re-scanned 182 files across 37 workspaces (76 MB total in `workspaceStorage`):

- **Format is unchanged.** Every file is `version: 3`. The JSONL operation log uses kinds `0` (snapshot), `1` (set) and `2` (splice); kind `3` (delete) was not observed. There were no bad lines, and the replay logic from the March study still works.
- **Most files are empty.** 162 of 182 sessions have no requests. The 20 with content date from 2025-09 (15), 2026-03 (3) and 2026-04 (2). Nothing is newer, because local chat has moved to the agent host on this machine.
- **There is some token data now**, which corrects the March study's "no token usage on disk". `result.metadata.promptTokens`/`outputTokens` and request-level `completionTokens`/`elapsedMs` appear on newer requests (2 of 37). `result.timings` is on all of them.
- **Response kinds are unchanged:** `toolInvocationSerialized` 199, `text` 193, `thinking` 126, `inlineReference` 98, `textEditGroup` 20, and so on. Tool IDs are also unchanged (`copilot_readFile`, `run_in_terminal`, `copilot_findTextInFiles`, `copilot_applyPatch`, `manage_todo_list`, `runSubagent`, `search_subagent`).
- The global `chat.ChatSessionStore.index` is now empty (`{"entries":{}}`); per-workspace indexes remain.

The March design still stands for this source: a replay → `TypedEvent` translator behind a `SessionProvider` trait. That trait is the same foundation the Codex and Claude Code report needs, so building it once serves all three. **Effort: Medium (2–3 weeks on top of the shared foundation). Value: low unless local chat usage comes back.**

---

## 6. Suggested plan

**Decision (2026-10-04): no code changes for now.** VS Code-launched sessions already render as Copilot sessions.

A "VS Code" card badge was prototyped and dropped, for three reasons:

- It would be on about 93% of cards, so it distinguishes little.
- It needed a full re-index (an analytics-version bump).
- It needed `host_type` overloaded, since Copilot now writes the repository host there.

The prototype's approach, if ever wanted: detect `client_name: vscode*` or `vscode.metadata.json` in the summary loader, and ignore `copilotVersion 0.0.0` in the indexer.

Revisit only when a concrete gap is reported, such as missing cost on agent-host sessions or a stale "running" state.

| Phase | Work | Effort | Needs provider abstraction? |
| --- | --- | --- | --- |
| 1 | *If needed:* origin label/filter (`client_name`, `vscode.metadata.json`); ignore `0.0.0` versions | 1–2 days + one re-index | No |
| 2 | *If needed:* read-only VS Code overlay: `agent-host.db` + `agentSessionData` wrapper → title, archived/read, wrapper↔SDK ID map, per-request `turn_usage` when there is no shutdown; liveness for agent-host sessions | 1–1.5 weeks | No |
| 3 | Codex provider (covers the VS Code Codex extension) | 3–5 weeks + foundation | Yes |
| 4 | Classic local chat provider | 2–3 weeks + foundation | Yes |
| — | Optional: "Open in VS Code" deep link using the wrapper ID | Small | No |

Guardrails, carried over from the existing session-store research:

- Open VS Code's databases with `mode=ro` and short-lived connections, and never write.
- Detect columns with `pragma table_info`, not version numbers.
- Treat the overlay as optional enrichment; `events.jsonl` stays canonical.

**Risk:** the agent host is new and moving fast. It has dual `sessions`/`sessions_v2` tables, `legacy_mirrored_revision`, and backfill and migration flags in `agent-host.db` metadata. The overlay must degrade quietly.

---

## 7. Open questions for you

1. **What looked imperfect?** §3 lists what the data suggests: cost/tokens, running state, version `0.0.0`, archived sessions still showing, title, hook noise, badge. Knowing which ones you saw confirms the priority.
2. **Do you still use classic VS Code chat (Ask/Edit/local agent), or only the agent/CLI-backed sessions?** If only the latter, phase 4 can be dropped.
3. **A richer sample would help.** The only agent-host session on disk is a one-turn "say hello" with no tool calls. A real session with tool calls and ideally a subagent, then closing it in VS Code, would confirm whether a `session.shutdown` is ever written and how subagents and per-turn usage appear.
