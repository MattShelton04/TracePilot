# Skills analytics — design

Status: **Implemented** (2026-09-20, PR #841). This extends the existing Skills manager
(`skills` feature flag). Related: [Agents explorer design](agents-explorer-design.md), which
shares the editor shell and usage patterns. Also
[prompt-cache insights](prompt-cache-insights-plan.md).

What shipped differs from this design in the ways recorded in §14. The sections below are kept
as written so the reasoning behind each decision stays readable; where they disagree with the
code, §14 says which won and why.

## 1. Problem

The Skills manager shows what is **installed** (scope, enabled state, estimated token cost,
assets). It does not show what is **used**. The only session-derived data is "encountered"
project skills: skills invoked in the last 100 sessions that *aren't* installed
(`commands/skills/encountered.rs`, `stores/skills/encountered.ts`).

Local evidence (all 388 sessions):

- 18 installed skills, 9 enabled. **All 9 enabled skills have 0 invocations** and add about 1.3k
  listing tokens per turn.
- The 3 most-used skills (frontend-design 54 uses, tracepilot-app-automation 47,
  playwright-cli 30) are **disabled**.
- `testing-usability` was invoked 12 times but isn't installed. It was loaded from a directory
  named `usability-testing`, so the name and directory don't match.
- Some skills were invoked by subagents (14 of 162 `skill.invoked` events carry an `agentId`).

## 2. Goals

1. Per-skill usage for **every** skill (installed, missing, built-in): uses, sessions, repos,
   first and last use, trend.
2. Actionable flags: unused, dormant, used-but-disabled, missing, drifted, shadowed.
3. Context: who invoked it (user or agent, main or which subagent), in which repos, with which
   models, and what each use cost in injected tokens.
4. A navigable path from a skill to the sessions and turns that used it, and back.
5. Reuse existing infrastructure: the indexer, the search tokens estimate and the editor shell.

**Non-goals:** judging skill *quality* or outcomes (no reliable signal exists), and storing
skill content from sessions.

## 3. Data sources and version coverage

| Source | Fields | Available from | Notes |
|---|---|---|---|
| `skill.invoked` event | `name`, `path`, `content` | 1.0.2 | Primary source |
| | `allowedTools` | intermittent 1.0.4+ | |
| | `description` | 1.0.11+ | |
| | `source`, `trigger` (`user-invoked` / `agent-invoked`) | **1.0.49+** | only 3 of 162 local events carry `trigger` |
| | `model`, `pluginName`, `pluginVersion`, `disableModelInvocation` | schema 1.0.83 | not yet observed locally |
| | envelope `agentId` | when invoked inside a subagent | |
| `tool.execution_start` with `toolName == "skill"` | `arguments.skill` (name only) | 1.0.x | **Fallback.** Some early sessions have the tool call but no event. |
| Installed skills | `discover_all_detailed` (global, repository, built-in) | always | Existing |
| `settings.json` `disabledSkills`, repository disables | | always | Existing (`copilot_config.rs`) |
| `copilot skill list --json` | name, source, path, enabled | CLI 1.0.65+ (verified on 1.0.83) | Optional cross-check. The source labels (`project`, `personal-copilot`, `builtin`) help resolve plugin and `--add-dir` skills. |

Coverage by version band: 0.0.x has no skills. In 1.0.0–1.0.19, 36 of 39 sessions with a skill
tool call also have the event. From 1.0.20 onward, all of them do.

## 4. Identity resolution

One skill can appear under several names or paths. Resolve each invocation to a **skill
identity** in this order:

1. **Path match.** Normalise the `path` (case-folded on Windows, separators unified, strip
   `SKILL.md`). If it points inside an installed skill directory, use that installed skill. The
   path wins over the name, which handles the name/directory mismatch.
2. **Name match** against installed skills in precedence order: project, then plugin-dir, then
   personal, then built-in (CLI 1.0.55 precedence). Mark it `resolution = name` (less certain).
3. **Unresolved.** Record it as a *missing* skill, keyed by normalised name, keeping the last
   seen path and description (today's "encountered" behaviour).

Content drift: store `sha256(content)` for each invocation. When it differs from the hash of the
current installed `SKILL.md`, the skill has **changed since it was used**. Show this so that old
usage isn't read as evidence about the current version.

## 5. Data model (indexer)

New table in `tracepilot-indexer`. Bump **`CURRENT_ANALYTICS_VERSION`** (10 if landed after the
cache plan, otherwise 9 → 10). Existing sessions are then re-extracted without touching source
files.

```sql
CREATE TABLE IF NOT EXISTS session_skill_invocations (
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_index     INTEGER NOT NULL,
  ts_unix         INTEGER,
  turn_index      INTEGER,            -- main-conversation turn, via the state machine
  skill_name      TEXT NOT NULL,      -- as recorded
  normalized_name TEXT NOT NULL,
  skill_path      TEXT,               -- as recorded (may be empty for SDK-provided skills)
  source          TEXT,               -- event.source when present
  trigger         TEXT,               -- user-invoked | agent-invoked | NULL
  agent_id        TEXT,               -- NULL = main agent
  agent_name      TEXT,               -- resolved from subagent.started when agent_id present
  model           TEXT,               -- event.model, else the active model at that point
  content_sha256  TEXT,
  content_tokens  INTEGER,            -- estimate via existing token estimator; content not stored
  plugin_name     TEXT, plugin_version TEXT,
  origin          TEXT NOT NULL,      -- 'event' | 'tool_call_fallback'
  PRIMARY KEY (session_id, event_index)
);
CREATE INDEX idx_ssi_name ON session_skill_invocations(normalized_name, ts_unix);
```

The repository comes from `sessions` (already indexed). Resolving against installed skills
happens **at query time**, because installation changes independently of history.

Extraction reuses the conversation state machine (as the 1.0.83 alignment did for search
attribution). That way `turn_index` and agent ownership are consistent with the Conversation
tab. De-duplicate each event against its tool-call fallback by `toolCallId` or timestamp.

## 6. Metrics and flags

| Metric | Definition |
|---|---|
| Uses | Count of invocations in the selected range (default 90 days, with All time available) |
| Sessions / Repos | Distinct counts |
| First / last used | Min and max timestamps |
| Trend | Weekly buckets (12 weeks) |
| Trigger mix | user / agent / unknown. Unknown is shown honestly for events before 1.0.49. |
| Invoked by | main agent vs each subagent type |
| Models | Top models active at invocation |
| Injected tokens per use | Median `content_tokens`. This is the context cost when invoked, not the listing cost. |
| Listing cost | Existing `frontmatterTokens` estimate. This is what an enabled skill costs every turn, even when unused. |

| Flag | Rule | Suggested action |
|---|---|---|
| **Unused** | enabled, installed, 0 uses in range, installed longer than the range (use directory mtime when there's no history) | Disable, or check the description triggers |
| **Dormant** | enabled, last used more than 60 days ago | Review |
| **Used, disabled** | disabled, 1+ uses in range | Re-enable? |
| **Missing** | invoked, unresolved | Find source (today's "encountered" behaviour, generalised) |
| **Drifted** | the latest invocation's hash differs from the installed hash | Informational |
| **Shadowed** | the same normalised name is installed in 2+ scopes | Show which one wins by precedence |

All thresholds live in one module (`skillUsageFlags.ts`) with unit tests. Flags never auto-act.

## 7. UX

### 7.1 Skills manager (`SkillsManagerView.vue`)

- **Stats strip:** add "Used (90d)" and "Unused & enabled" chips next to the Installed, Global,
  Project, Built-in and Active chips.
- **Insight bar** (dismissible for each insight, stored in preferences). Example: "9 enabled
  skills unused in 90 days · ~1.3k tokens per turn". Clicking it applies the matching filter.
- **Filter row:** keep the scope segmented control and search. Add flag chips (Unused, Used but
  disabled, Missing, Drifted), a range selector (30d / 90d / All), and sorting (Name, Uses,
  Last used, Listing cost).
- **`SkillCard.vue`:** add a usage line ("54 uses · 14 sessions · last 13 May"), a 12-week
  sparkline and flag badges. Missing skills keep the current encountered card style, now with
  usage.

### 7.2 Skill detail (editor)

`SkillEditorPreviewPane` becomes a tabbed pane: **Preview | Usage**. The Usage tab contains:

- summary figures and the trend chart;
- trigger mix and invoked-by (main vs subagents);
- repos and models;
- the drift notice;
- **recent invocations**, which link to the session's Conversation tab at the turn, reusing the
  deep-link used by search results.

Read-only skills (built-in) still get the Usage tab.

### 7.3 Session side

`SkillInvocationEventRow.vue` gains an "Open skill" link, resolved via §4, and a subtle
"used in N sessions" hint. Unresolved invocations link to the missing-skill card.

### 7.4 Analytics

Add a "Skills" card to the Analytics dashboard: top skills by uses, unused-enabled count and
listing-token overhead. It respects the dashboard's existing repo and date filters.

## 8. Backend and IPC

| Command | Returns |
|---|---|
| `skills_usage_summary(range, repo?)` | Map from skill identity to aggregates and flags inputs. One call per page load. |
| `skills_usage_detail(identity, range)` | Trend, mix, repos, models and recent invocations (paginated) |
| `skills_encountered_project` | **Kept** as a compatibility shim. It is re-implemented on the new table once indexing is complete, with the current search_content scan as the fallback during re-index. |

Identity resolution (§4) lives in `tracepilot-orchestrator/src/skills/usage.rs`, because it
needs the installed-skill discovery that already lives there.

Enable and disable: keep `set_skill_enabled` (a `settings.json` write). When the installed CLI
is 1.0.85 or later (`version_manager`), optionally call `copilot skill enable|disable` and
fall back to the file write on any failure.

## 9. Fallbacks and edge cases

| Case | Behaviour |
|---|---|
| Index not yet at the new version | Cards show "Usage available after re-index" and a progress hint. Encountered skills still work via the old scan. |
| Sessions before 1.0.49 | Trigger shown as "unknown". No false split. |
| Fallback (tool call only) invocations | Name-only resolution, no drift or tokens. `origin` is shown in the detail tooltip. |
| Empty `path` (SDK-provided skill) | Source is "SDK". Resolve by name only. |
| Session files deleted | Rows are removed through the existing prune path, and aggregates update. |
| Skill renamed on disk | Path resolution keeps history attached if the directory stayed the same. Otherwise it shows as missing plus unused. Show a hint: "Possibly renamed: same directory, different name". |
| No sessions at all | Usage UI hidden, and the manager behaves as it does today. |
| CLI `dynamicRetrieval` on | The listing cost tooltip notes that retrieval may include only some skill descriptions per turn. |

## 10. Code reuse with the Agents explorer

The Skills editor components (`components/skillEditor/*`, `useSkillEditor.ts`, 469 lines) are
the template for the Agents editor. Phase 3 of this design extracts a generic
`DefinitionEditor` shell. The detailed plan is in
[agents-explorer-design.md §6](agents-explorer-design.md).

As shipped, the reuse runs the other way: the Agents explorer landed first, so Skills adopted
what it had built rather than the reverse.

- `utils/usage/range.ts` is the shared range module. `utils/agents/range.ts` is now a pure
  re-export of it, so both features compute identical `fromDate`/`toDate` bounds and label a
  range the same way.
- `components/usage/UsageSparkline.vue`, `UsageStackedBar.vue` and `UsageBreakdownBars.vue` are
  used unchanged by the skill Usage tab and the dashboard panel.
- `utils/skills/entries.ts` mirrors `buildAgentEntries`, and `AnalyticsSkillsPanel.vue` mirrors
  `AnalyticsAgentsPanel.vue`: each queries its own summary command with the dashboard's range
  and repository rather than widening `AnalyticsData`.
- `.panel-header--tabs` moved from `agent-editor.css` into `definition-editor.css`, so both
  editors share one rule.

## 11. Phases

1. **Indexer and summary:** the table, extraction, `skills_usage_summary`, card usage lines,
   stats chips and sorting.
2. **Flags and insight bar:** the flags module, filters and range selector.
3. **Detail Usage tab:** the Usage tab and generic usage components, plus session-side links.
4. **Analytics card and CLI verbs:** the dashboard card and the optional
   `copilot skill enable/disable`.

## 12. Testing

- **Fixture sessions:**
  - 1.0.2 (no description);
  - 1.0.49 (trigger);
  - 1.0.83 (`agentId`);
  - a tool-call-only fallback;
  - a name/directory mismatch;
  - a drifted content hash;
  - an SDK skill with an empty path.
- **Rust:** extraction, de-duplication, resolution precedence, prune.
- **Vue:** flag rules, card rendering, range switching.
- **Real app:** a Skills page with the real 388-session index; check the three viewports and
  re-index progress.

## 13. Open questions

- Should "Unused" consider **user-level** vs **repo-level** scope separately? A project skill
  can be unused in this repo but used elsewhere. **Resolved for the dashboard:** the Analytics
  panel withholds the unused line entirely while a repository filter is active, because the
  catalog is machine-wide and comparing it against one repository's usage would call skills
  unused that are used constantly elsewhere. The manager has no repository filter, so the
  question does not arise there.
- Should the insight bar offer one-click "Disable all unused"? **Resolved:** there is no insight
  bar (§14.6). The "Unused & enabled" count in the stats strip narrows the list to exactly those
  skills, and each row keeps its own toggle. Nothing acts in bulk.

## 14. What shipped, and where it diverges

1. **Timestamps are RFC3339 `TEXT`, not `ts_unix`.** Every other child table filters with
   `date(COALESCE(x, s.created_at))`; a second convention would have meant a second way to get
   date filtering wrong.
2. **Resolution and merging live in TypeScript** (`utils/skills/entries.ts`), not in a Rust
   `skills/usage.rs`. This mirrors `buildAgentEntries`, and makes the rules — directory first,
   then name — unit-testable without a database. Rust stays pure aggregation.
3. **`skills_encountered_project` is removed, not shimmed.** The usage table supersedes it for
   every scope and all history, rather than 100 sessions of project skills, and its removal
   drops a ~300-line runtime event-log scan.
4. **Tokens are stored as `frontmatterTokens` + `instructionTokens`**, so a skill that is no
   longer installed still has a listing-cost estimate.
5. **Every late-added CLI field carries its denominator on screen.** No corpus-wide gap is
   folded into a known bucket: a trigger split where nothing was recorded is stated as a
   sentence rather than drawn as a 100%-neutral bar.
6. **There is no insight bar.** The stats strip already states the same counts, so the bar was a
   second voice repeating them. Its useful half — one click from a count to its evidence — moved
   onto the counts themselves.
7. **The range is remembered, and an empty range says which kind of empty it is.** The local
   corpus's skill use all predates the 90-day default, so a window with no uses offers
   "Show all time"; only an all-time query with no uses claims the index has nothing. For the
   same reason `unused` is withheld when the index recorded no use at all — otherwise the flag
   describes the index rather than the skill.
8. **`?tab=usage`** opens the editor directly on Usage, which is how the conversation row's
   "View usage" and the dashboard reach it.
