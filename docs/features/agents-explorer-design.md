# Agents explorer — design

Status: **Delivered** (2026-09-20), behind the `agents` feature flag.
See §14 for where the implementation deviates from this design.
Builds on: the Config Injector (experimental, `configInjector` flag),
[subagent analysis](subagent-analysis-plan.md) (Metrics → By agent, delivered),
[Skills analytics design](skills-analytics-design.md) (shared editor shell and usage components).

## 1. Problem

Agents are now the main unit of work in Copilot CLI sessions: 5,673 subagent launches locally,
up to 13 running at once. Yet TracePilot only shows them in two places:

- **Config Injector → Agents** (experimental). It reads the built-in
  `pkg/<version>/definitions/*.agent.yaml`, changes the `model:` line with backups, and applies
  a model to all agents in one go. It doesn't know about custom agents, per-agent settings
  overrides, or usage.
- **Per session:** Metrics → By agent, the activity panel and the agent tree timeline. There is
  **no cross-session view** of how each agent behaves.

Custom agents have become much more capable:

- a list of fallback models plus `model-policy` (1.0.83);
- `reasoning-effort` (1.0.66);
- `include-custom-instructions` (1.0.86);
- `deferred-tool-loading` (1.0.52);
- `mcp-servers` in frontmatter;
- discovery from `--add-dir` (1.0.81) and plugins (1.0.85);
- `/subagents` per-agent model, effort and context-tier settings (1.0.62).

None of this can be explored in TracePilot.

## 2. Goals

1. **Explore** every agent definition, built-in and custom, from every source, in a view and
   editor that feel like the Skills manager. Most of the code is reused.
2. **Analyse** agent and subagent invocations across sessions:
   - volume and trends;
   - models actually used, compared with the configured model;
   - duration, tokens and tool calls;
   - failures and cancellations;
   - nesting depth and parallelism.
3. **Edit safely.** Custom agents are edited in place with backups. Built-in agents are
   overridden through supported settings where possible, and the YAML in the installed package
   is edited only as a flagged fallback.
4. Degrade cleanly for older sessions and missing sources.

**Non-goals:** launching agents from TracePilot (that stays with the Launcher), and scoring
agent "quality".

## 3. Sources of truth

### 3.1 Definitions

| Source | Location | Format | Scope label |
|---|---|---|---|
| Built-in | `~/.copilot/pkg/<platform>/<version>/definitions/*.agent.yaml` (per installed CLI version) | YAML: `name`, `displayName`, `description`, `model`, `reasoningEffort`, `tools[]`, prompt with `{{placeholders}}` | Built-in |
| User | `<COPILOT_HOME>/agents/**/*.agent.md` (the CLI's "User (~/.copilot/agents)" option) | Markdown with YAML frontmatter and the prompt as the body | Personal |
| Project | `<repo>/.github/agents/**/*.agent.md` (nested, discovered from subdirectories since 1.0.62), `<repo>/.claude/agents/**` | same | Project |
| `--add-dir` directories | `<dir>/.github/agents` (1.0.81) | same | Added directory (session-specific, shown only from session evidence) |
| Plugins | `~/.copilot/installed-plugins/<plugin>/…/agents` (selectable in 1.0.85) | same, with `${PLUGIN_ROOT}` expansion in `mcp-servers` | Plugin |

Frontmatter keys to support. They were observed in CLI 1.0.83 strings and the changelog;
confirm each against CLI docs before shipping:

- `name`, `description`, `tools`;
- `model` (a string, or a list since 1.0.83);
- `model-policy` (`required`);
- `reasoning-effort`, `context-tier`;
- `include-custom-instructions` (1.0.86);
- `deferred-tool-loading`, `mcp-servers`;
- `disable-model-invocation`, `user-invocable`.

Unknown keys are preserved on save and shown read-only in an "Other fields" group.

### 3.2 Agent settings

These live in user or repo `settings.json` and are managed by the CLI's `/subagents` and
`/settings`. The top-level settings keys confirmed in the 1.0.83 binary are `subagents`,
`builtInAgents`, `customAgents` and `disabledSubagents`. The API schema describes
`disabledSubagents`, `maxConcurrency` (1–128) and `maxDepth` (1–128).

Per-agent `model`, `reasoningEffort` and `contextTier` under `subagents` come from the 1.0.62
changelog, but **the exact JSON shape must be confirmed** by running `/subagents` and inspecting
the result (§12). Precedence to show in the UI: explicit model in the task call, then the
`/subagents` setting, then the definition's `model`.

### 3.3 Runtime evidence (session events)

Field coverage by CLI version, measured on local sessions:

| Band | `subagent.started` | `subagent.completed/failed` | Other |
|---|---|---|---|
| 0.0.x | name, displayName, description | name only (no model, tokens or duration) | |
| 1.0.0–1.0.19 | same | model, tool calls, tokens and duration on **27%** of completions | `task` tool arguments include `agent_type`, `name`, `model`, `mode` |
| 1.0.20–1.0.39 | envelope `agentId` on about 48% | model and metrics on 66% | |
| 1.0.40–1.0.82 | `agentId` on 100%; `model` rare | metrics on 93% | |
| 1.0.83 | + `agentType`, `executionMode`, `resumable`, `parentId`, `model` | + `firstDispatchedModel`, `explicitModelOverride`, `cancelled` (the schema also lists `configuredModelPreference`, `configuredModelMatchesActual`, `modelOverrideReason`) | `subagent.configured` (model, effort, context tier, multiTurn); `session.shutdown.agentMetrics` ledger |

The main-session custom agent is recorded by `subagent.selected` / `subagent.deselected`
(name, displayName, tools). There are none locally, because no custom agents exist yet.

The existing reconstruction logic handles instance identity, multi-turn workers and delayed
completion (1.0.83 alignment). **The explorer must reuse it and not re-derive it.**

## 4. Information architecture

A new sidebar entry, **Configuration → Agents**, placed next to Skills and behind the feature
flag `agents` (recommended). The Config Injector's Agents tab becomes a compact
"bulk model assignment" view. Each row links to the Agents page, and both use the same backend
(§7).

```
Agents (manager)                         Agent detail  /agents/:id
├─ stats strip                           ├─ top bar: name · scope badge · source path · actions
├─ insight bar                           ├─ left: Definition editor (form + prompt)
├─ filters: scope · flags · range · search├─ right tabs: Preview | Usage | Effective config
└─ card grid (definitions + unresolved)  └─ status bar: validation · save state · backup
```

## 5. Screens

### 5.1 Manager (`AgentsManagerView.vue`)

This mirrors `SkillsManagerView.vue`:

- **Stats strip:**
  - N definitions, split into Built-in, Personal, Project and Plugin;
  - runs in the selected range;
  - failure rate;
  - "Unresolved" count (agents seen in sessions whose definition wasn't found).
- **Insight bar** (dismissible). Examples:
  - "explore ran 2,411 times; 0 failures";
  - "3 agents ran on a model different from the one configured (1.0.83+)";
  - "custom agent X never used".
- **Filters:**
  - scope segments;
  - flag chips (Unused, Model mismatch, Failing more than 10%, Disabled, Overridden);
  - range (30d / 90d / All);
  - sort (Name, Runs, Failure %, Median duration, Last used).
- **`AgentCard`**, which extends the `SkillCard` layout:
  - icon from `agentMeta.ts`, name and display name, scope badge;
  - models ("gpt-5.4-mini · low" or "claude-opus-5 → gpt-5.6-luna");
  - tool count;
  - usage line ("2,411 runs · p50 38 s · 0.4% failed · last 12 Sep") and a sparkline;
  - flag badges.

### 5.2 Detail and editor (`AgentEditorView.vue`)

- **Custom agents (`.agent.md`).** A metadata form driven by the frontmatter field schema (§3.1):
  - a model list editor with ordered fallbacks;
  - a `model-policy` toggle;
  - an effort select filtered by the chosen models' capabilities, reusing the model catalogue in
    `@tracepilot/types`;
  - a tools picker with free text;
  - boolean toggles.

  Below the form is a markdown prompt editor, reused from the skill editor.
- **Built-in agents (`.agent.yaml`).** Read-only by default and labelled
  "Installed with Copilot CLI <version>". Actions:
  - **"Override for my sessions"**, which writes the `/subagents` setting (the supported route
    that survives updates);
  - **"Edit definition (advanced)"**, only when `configInjector` is enabled. This does a YAML
    edit with a backup, a diff preview, and the warning "overwritten when Copilot CLI updates
    (COPILOT_AUTO_UPDATE)". It uses the existing `write_agent_definition` and `BackupStore`.
- **Right-hand tabs:**
  - **Preview.** The rendered prompt. `{{placeholders}}` are highlighted and resolved where
    known (e.g. `{{grepToolName}}`).
  - **Usage.** See §5.3.
  - **Effective config.** The resolved model chain, effort and tools, showing where each value
    comes from (definition, settings override, repo settings). Example: "model: gpt-5.6-luna
    (from /subagents setting; definition says gpt-5.4-mini)".

### 5.3 Usage tab (shared components with Skills)

- Runs over time, with outcome split (completed, failed, cancelled, idle or incomplete).
- **Models actually used** compared with the configured model, including
  `firstDispatchedModel` and the override reason (1.0.83+).
- Distributions: duration, tokens (labelled "includes descendants", see §8) and tool calls.
- Invoked by: which parent (main or another agent), depth histogram, parallelism (peak
  concurrent siblings).
- Failure reasons, grouped by normalised `error` text.
- Recent runs. Each opens the session with the **existing subagent activity panel** focused, so
  there's no second agent browser.

### 5.4 Analytics hook

Add an **Agents** card to the Analytics dashboard: top agents by runs and credits, failure rate,
depth and parallelism. Credits come only from the `agentMetrics` ledger (1.0.83+), with the
denominator shown.

## 6. Code reuse: a generic definition editor

The skill editor is already split into a shell and parts:

- `SkillEditorView.vue` (82 lines);
- `components/skillEditor/*`: TopBar, MetadataForm, MarkdownEditor, PreviewPane, StatusBar and
  AssetPreviewModal;
- `useSkillEditor.ts` (469 lines): load, dirty state, save, resize and read-only handling.

The plan is a refactor followed by a second consumer:

1. **Extract** `components/definitionEditor/` (DefinitionEditorShell, TopBar, StatusBar,
   MarkdownEditor, PreviewPane with named tab slots, ResizableSplit) and a composable
   `useDefinitionEditor<TDef>(adapter)`:

   ```ts
   interface DefinitionAdapter<TDef> {
     kind: "skill" | "agent";
     load(id: string): Promise<LoadedDefinition<TDef>>;          // raw text + parsed + readOnlyReason
     validate(draft: string): Promise<Diagnostic[]>;
     save(id: string, draft: string): Promise<SaveResult>;       // backups handled server-side
     frontmatterSchema: FieldSpec[];                             // drives MetadataForm
     previewTabs: PreviewTabSpec[];                              // Preview | Usage | Effective config | Assets
     fileLabel(def: TDef): string;                               // "SKILL.md" / "reviewer.agent.md"
   }
   ```

2. **Skills adopts it with no behaviour change.** It's guarded by the existing skill editor tests
   plus a visual comparison (`docs/visual-regression.md`). `SkillEditorMetadataForm` becomes a
   `FieldSpec[]`.
3. **Agents are the second adapter.** Add a YAML mode for built-in agents: a code editor with
   YAML highlighting, plus structured fields for `model`, `reasoningEffort` and `tools` that
   round-trip through the YAML.
4. **Shared usage components** from the Skills design (`components/usage/*`): trend sparkline,
   breakdown bars, recent-runs list, flag badge and insight bar.

Stores follow the `stores/skills/*` split (discovery, loading, mutations, computed, context)
as `stores/agents/*`.

## 7. Backend

### 7.1 Orchestrator: `tracepilot-orchestrator/src/agents/`

| File | Responsibility |
|---|---|
| `discovery.rs` | Enumerate the sources in §3.1. Built-ins come from the **active** CLI version (via `version_manager`), plus optionally other installed versions for comparison. Repo roots come from `repo_registry`. |
| `parse.rs` | YAML (built-in) and `.agent.md` frontmatter parsing with key preservation. Model may be a string or a list. Diagnostics mirror `SkillDiagnostic`. |
| `write.rs` | Atomic write plus `BackupStore` (moved from `config_injector.rs` and shared). Custom agents only, or built-in when "advanced" is enabled. |
| `settings.rs` | Read and write the `subagents` and `disabledSubagents` settings, reusing the `copilot_config.rs` helpers (JSON with comments, `settings.json` only). |
| `effective.rs` | Resolve the effective model chain, effort and tools, with provenance. |

`config_injector::read_agent_definitions` becomes a thin call into `agents::discovery` for the
built-in source, so the Config Injector keeps working unchanged.

### 7.2 Indexer

```sql
CREATE TABLE IF NOT EXISTS session_agent_runs (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_key TEXT NOT NULL,              -- agent instance id (agentId) or toolCallId for pre-1.0.20
  tool_call_id TEXT, parent_run_key TEXT, depth INTEGER,
  agent_name TEXT NOT NULL, agent_type TEXT, display_name TEXT,
  execution_mode TEXT,                -- sync | background (1.0.83) else NULL
  started_at INTEGER, ended_at INTEGER,
  outcome TEXT NOT NULL,              -- completed | failed | cancelled | idle | incomplete
  error_text TEXT,
  model_at_start TEXT, configured_model TEXT, configured_effort TEXT, context_tier TEXT,
  first_dispatched_model TEXT, explicit_model_override TEXT, model_override_reason TEXT,
  configured_matches_actual INTEGER,
  total_tool_calls INTEGER, total_tokens INTEGER, duration_ms INTEGER,
  own_nano_aiu INTEGER,               -- from agentMetrics ledger when present
  multi_turn INTEGER, follow_up_count INTEGER,
  source TEXT NOT NULL,               -- events | task_args_fallback
  PRIMARY KEY (session_id, run_key)
);
CREATE TABLE IF NOT EXISTS session_agent_selection (
  session_id TEXT NOT NULL, event_index INTEGER NOT NULL, agent_name TEXT, selected INTEGER,
  ts INTEGER, PRIMARY KEY (session_id, event_index)
);
```

Extraction reads the existing reconstructed subagent state (turns reconstructor and
`models/agent_usage.rs`), not raw events. That keeps the Agents page consistent with the
Conversation tab and Metrics. Bump the analytics version (shared with the other designs if they
land together).

### 7.3 IPC

| Command | Purpose |
|---|---|
| `agents_list(repo_root?)` | Definitions from all sources, with diagnostics |
| `agents_get(id)` / `agents_save(id, content)` / `agents_create(scope, name)` / `agents_delete(id)` | Editor operations (custom agents) |
| `agents_set_override(name, {model?, effort?, contextTier?})` / `agents_set_disabled(name, bool)` | Settings-based overrides |
| `agents_usage_summary(range, repo?)` / `agents_usage_detail(name, range)` | Analytics |

## 8. Accounting rules (inherited, do not break)

These rules come from the subagent analysis:

- The `subagent.completed.totalTokens` value **can include descendants**. Label it that way, and
  never sum it across a hierarchy.
- Exclusive per-agent usage and credits come only from the `agentMetrics` ledger (1.0.83+).
  Successive ledgers are snapshots, not increments.
- A 1.0.83 multi-turn worker may emit one completion across several turns, and follow-ups come
  from `write_agent` / `read_agent` telemetry. Use the reconstructed status, not the raw event
  count.

## 9. Fallbacks

| Situation | Behaviour |
|---|---|
| No custom agents anywhere (the current local state) | Built-ins still show with full usage. The empty custom section offers "Create agent" (Personal or Project) with a template. |
| Built-in `definitions/` missing (CLI not installed locally, or an unusual install) | Built-in cards are synthesised from session evidence, marked "definition unavailable", with usage intact. |
| Agent seen in sessions but no definition found (renamed, deleted, plugin removed, `--add-dir`) | An **Unresolved** card keyed by name, with usage, last-seen description and "where seen". |
| Pre-1.0.20 sessions (no instance id) | `run_key = toolCallId`. Depth comes from the tool-call nesting already reconstructed. |
| 0.0.x completions without metrics | Outcome and name only. Metrics columns show "—" and are excluded from medians. The denominator is shown. |
| `agentType` missing (before 1.0.83) | Derived from `agentName` for built-ins, or from the `task` tool's `agent_type` argument. |
| No `subagent.configured` (before 1.0.83) | Configured model and effort show "not recorded". The "Model mismatch" flag is only computed where both sides exist. |
| No `agentMetrics` ledger | Credits hidden for that run. Tokens use `totalTokens` with the "includes descendants" label. |
| Incomplete runs (crash, live) | Outcome `incomplete`, or `running` for live sessions via the existing refresh. |
| Settings `subagents` shape differs from expectation | Read-only display of the raw value, and override actions disabled with a notice. Never overwrite unknown shapes (same policy as `disabledSkills` validation today). |
| Built-in YAML edit when the CLI auto-updates | Warning plus backup. After an update the Agents page detects a changed file hash and offers "re-apply from backup". This extends the Config Injector's version comparison. |
| Multiple installed CLI versions | Default to the active version. A version picker shows definition diffs (reusing `diff_files`). |

## 10. Flags and insights

| Flag | Rule |
|---|---|
| Unused (custom) | 0 runs in range, and the definition is older than the range |
| Model mismatch | `configured_matches_actual = false`, or `first_dispatched_model ≠ configured_model` (1.0.83+) |
| Failing | failed and cancelled runs above 10% of runs (with at least 20 runs) |
| Slow | p90 duration more than 3× the agent's own median over the previous range (trend-based, not absolute) |
| Overridden | a `/subagents` setting overrides the definition's model |
| Disabled | listed in `disabledSubagents` |

## 11. Phases

1. **Read-only explorer:**
   - discovery across all sources, the manager page and card grid;
   - detail with Preview and Effective config;
   - Unresolved cards from the existing index (using `recent_*`-style scans until the table
     exists).
2. **Usage analytics:** the `session_agent_runs` extraction, Usage tab, flags, insight bar and
   Analytics card.
3. **Editor:** extract the definition editor (Skills first, no behaviour change), then create
   and edit custom agents with backups.
4. **Overrides:** `/subagents` settings overrides and disabling. Advanced built-in YAML editing
   behind `configInjector`. Config Injector Agents tab links to the new page.

## 12. Validation plan

- **Settings shape:** set a per-agent model with `/subagents` in a scratch profile
  (`COPILOT_HOME`), then diff `settings.json` to confirm the shape before phase 4.
- **Custom agent:** create a test personal agent with `model: [claude-opus-5, gpt-5.6-luna]`,
  `model-policy: required` and `include-custom-instructions: true`. Run it via `--agent` and as a
  subagent. Confirm `subagent.selected`, `subagent.started.agentType`, the configured and
  dispatched models, and that the Agents page resolves it.
- **Fixtures:** 0.0.x, 1.0.10, 1.0.30, 1.0.71 and 1.0.83 sessions, plus nested, multi-turn and
  failed or cancelled runs (reusing the 1.0.83 compatibility fixtures).
- **Real app:** manager and detail at 1440×960, 960×640 and 2560×1440. Check that the Skills
  editor is visually unchanged after the extraction (visual CI).

## 13. Open questions

- Should the Agents page absorb the Config Injector's Agents tab entirely once phase 4 ships?
  Proposal: yes, keeping the Config Injector for global settings, versions and backups.
- Plugin agents: are they editable? Proposal: read-only, with "open plugin folder", because
  plugin updates overwrite them.
- Should the Launcher gain an "agent" picker using this catalogue (`--agent <name>`)? This is a
  natural follow-up.

## 14. As built

Delivered behind the `agents` flag, with **Configuration → Agents** between Skills and
CLI Context. What differs from the design above:

- **Settings shape confirmed** (§3.2, §12). CLI 1.0.79's bundle and `api.schema.json` give
  `subagents.agents.<agentType> = { model, effortLevel, contextTier }`, plus
  `subagents.disabledSubagents: string[]`; `model`, `effortLevel` and `contextTier` each accept
  `inherit`. This was verified end to end against a real `settings.json`: applying and removing
  an override leaves the file byte-identical to its original content. An unrecognised shape makes
  overrides read-only, as planned.
- **Editor extraction is narrower than the adapter in §6.** Rather than a generic
  `DefinitionAdapter<TDef>`, the genuinely shared pieces were extracted —
  `components/definitionEditor/MarkdownBodyEditor.vue`, the markdown toolbar,
  `useUnsavedChangesGuard`, and `styles/features/definition-editor.css`. Skills keeps its
  behaviour and its own composable; the Agent editor composes the same parts. A full adapter
  would have been indirection for two consumers.
- **Parsing and patching stay in Rust.** The form edits an `AgentFields` draft and the backend
  patches only the keys that changed, so comments, key order and unknown keys survive. A raw mode
  saves the whole file. There is no YAML library in the frontend.
- **Outcomes are `completed | failed | cancelled | incomplete`.** An idle multi-turn worker is
  reconstructed as completed rather than given its own outcome.
- **The Analytics card calls `agents_usage_summary` directly** with the dashboard's range and
  repository, so `AnalyticsData` is unchanged and no disk fallback is needed.
- **The database additions are one migration (18).** It creates both agent tables and their
  indexes together, upgrading directly from the released version 17 schema.
- **`slow` also needs at least 10 timed runs.** A p90-versus-previous-median trend over three
  runs is noise, which the real data made obvious.
- **`{{placeholders}}` are resolved in descriptions too**, not only in the prompt body, because
  the built-ins carry them in `description`.
- **The detail route is `/agents/detail?id=…`**, since a definition's id is a file path. Agents
  seen only in sessions use `name:<agent>`.
- **Cards and synthetic data are shared.** Agents and Skills use `DefinitionCard` from
  `@tracepilot/ui`; browser mocks and unit tests use factories from `@tracepilot/client/mock`.
  Visual captures use the browser corpus, including a dedicated Usage case.
- **The manager has no tips banner.** Scope and flag filters provide direct access to the
  same states. Read-only definitions use a badge with an explanatory tooltip.
- **Definition and Prompt resize independently.** Drag their horizontal divider or use
  Up/Down, Shift for larger steps, Home/End for limits, and Enter to reset.
- **Usage starts with balanced metrics and outcomes.** Models, failure reasons, timing and
  execution context expand on demand. Model detail includes all recorded models; missing
  model evidence is explicit. Reporting coverage stays visible with the metrics.

Not yet done: the Config Injector's Agents tab still owns bulk model assignment (§13's open
question) and now links into this page; the Launcher has no agent picker.
