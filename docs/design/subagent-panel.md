# Subagent Panel — Design & Consolidation

> Status: **Implemented (single unified body)** — supersedes the duplicated panels at
> `apps/desktop/src/components/conversation/SubagentPanel.vue` and
> `apps/desktop/src/components/agentTree/AgentTreeDetailPanel.vue`.
> The original plan called for two display modes (`stream` / `sections`); after
> implementation review they had converged so closely that the dispatcher and the
> second body component were collapsed away. There is now **one** body — both hosts
> render identical content. The host wrappers above are now thin chrome only.

## 1. Motivation

Today there are **two independent detail panels** that surface "everything we know about a subagent invocation":

| Panel | Path | Container | Layout style |
|---|---|---|---|
| **Conversation slide-out** | `apps/desktop/src/components/conversation/SubagentPanel.vue` | `position: fixed`, slide-in from the right, top-offset to clear the header | Header + prompt/output collapsibles + **chronological activity stream** (reasoning ⇢ tools ⇢ pills ⇢ nested subagents ⇢ messages) |
| **Agent-tree inline panel** | `apps/desktop/src/components/agentTree/AgentTreeDetailPanel.vue` | Inline block beneath the tree canvas, shown when a node is selected | Header + **separated sections** (Description, Source, Prompt, Info grid, Failure, Output, Result, Reasoning toggle, Tools & Agents list with expandable rows) |

They consume **different data shapes**, manage their **own** tool-result loaders and expansion state, and have **drifted** in features (pills, parallel-group label, cross-turn-parent row, model-substitution warning, agent type icon set, "Output" vs "Result" semantics).

This document defines:

1. A normalized `SubagentView` model that both call-sites can produce.
2. A single shared `<SubagentPanel>` component (in `packages/ui`) with two layout modes.
3. Thin host wrappers that own container chrome (slide-out vs inline) and data wiring.
4. Refresh / lifecycle semantics that both call-sites must obey.

## 2. Source data — what backs the view

A subagent invocation is captured in the event stream as a parent `TurnToolCall` (`isSubagent === true`) plus child events whose `parentToolCallId` points back at it. Children may appear in **later turns** than the parent (cross-turn fan-out).

Relevant fields on `TurnToolCall` (see `packages/types/src/conversation.ts`):

```ts
TurnToolCall {
  toolCallId, parentToolCallId, toolName, eventIndex,
  arguments,              // includes prompt, description, model, name
  success, error, startedAt, completedAt, durationMs, isComplete,
  isSubagent, agentDisplayName, agentDescription,
  model, requestedModel,  // mismatch ⇒ "model substituted" warning
  totalTokens, totalToolCalls,
  intentionSummary,       // AI-generated short intent
  resultContent           // ≤1 KB truncated preview; full via getToolResult()
}
```

Children:

- `TurnToolCall[]` with `parentToolCallId === parent.toolCallId` — the subagent's own tool calls (incl. nested subagents).
- `AttributedMessage[]` from `turn.assistantMessages` and `turn.reasoningTexts` with a matching `parentToolCallId` — the subagent's textual output and reasoning blocks.

Two utilities already aggregate these:

- `useCrossTurnSubagents(turns)` → `Map<agentId, SubagentFullData>` (`agentId`, `turnIndex`, `toolCall`, `childTools`, `childMessages`, `childReasoning`).
- `buildSubagentContentIndex(turns)` (in `@tracepilot/ui`) → `Map<agentId, { messages, reasoning }>` — used by the agent-tree builder to populate `AgentNode.messages` / `AgentNode.reasoning`.

`AgentNode` (in `apps/desktop/src/utils/agentTreeBuilder.ts`) flattens the same data with extra tree-context: `type`, `parallelGroup`, `isCrossTurnParent`, `sourceTurnIndex`, `children`.

### 2.1 States

| State | Predicate | Visual |
|---|---|---|
| **In progress** | `tc.isComplete === false` | warning-color status pill, **live** duration via `formatLiveDuration`, child stream may still grow |
| **Completed** | `tc.isComplete === true && tc.success !== false` | success-color status pill, frozen duration |
| **Failed** | `tc.isComplete === true && tc.success === false` | danger-color status pill; `tc.error` shown in a "Failure Reason" `<pre>` block |
| **Model substituted** | `isComplete && model && requestedModel && model !== requestedModel` | banner above body: "Requested `X` but ran as `Y`" |
| **Cross-turn parent** | (agent-tree only) `node.isCrossTurnParent` | "Source" row: "Launched in turn N" |
| **Parallel group** | (agent-tree only) `node.parallelGroup` set | parallel-group label badge |

## 3. Normalized `SubagentView`

`SubagentView` is a **UI-only** type that lives in `packages/ui`. It is _intentionally not fully decoupled_ from `TurnToolCall`: the shared component still renders raw tool calls via `ToolCallItem`, `ToolArgsRenderer`, and `ToolResultRenderer`, and we accept that coupling rather than half-normalize. **Adapters live in the app layer** (`apps/desktop`) — `packages/ui` must not import `apps/desktop` types like `AgentNode` or `SubagentFullData`.

```ts
// packages/ui/src/components/SubagentPanel/types.ts
import type { TurnToolCall } from "@tracepilot/types";

export type SubagentStatus = "in-progress" | "completed" | "failed";
export type SubagentType = "main" | "explore" | "general-purpose" | "code-review" | "task";

export interface SubagentView {
  /** Stable identifier — usually the parent tool-call id. For main-agent views, the turn id. */
  id: string;
  type: SubagentType;
  displayName: string;
  /** Durable agent description (e.g. agentDescription on the tool call). */
  description?: string;
  /** Per-invocation intent summary (intentionSummary || arguments.description || arguments.name). */
  intentSummary?: string;
  status: SubagentStatus;

  // Models & tokens
  model?: string;
  requestedModel?: string;
  /** Precomputed: completed && model && requestedModel && model !== requestedModel. */
  modelSubstituted: boolean;

  // Lifecycle
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  totalTokens?: number;
  /** Reported aggregate from SubagentCompleted/Failed events (may be undefined for in-progress). */
  totalToolCalls?: number;
  /** Observed/displayed tool-call rows (childTools.length); always defined. */
  toolCount: number;

  // Provenance
  turnIndex?: number;
  sourceTurnIndex?: number;
  isCrossTurnParent?: boolean;
  /** Optional human-readable parallel-group label (e.g. "Parallel Group A"); host computes. */
  parallelGroupLabel?: string;

  // Body content
  prompt?: string;
  /** Truncated parent-tool-call result (≤1KB preview). Rendered as "Output" in stream, "Result" in sections. */
  resultContent?: string;
  error?: string;
  /** Aggregated subagent assistant messages across turns. */
  messages: string[];
  /** Aggregated subagent reasoning blocks across turns. */
  reasoning: string[];
  /** Ordered child tool calls (by eventIndex). */
  childTools: TurnToolCall[];
  /** Chronological activity stream (precomputed by adapter via useSubagentActivities). */
  activities: SubagentActivityItem[];

  /** Raw parent tool call. Required for ToolResultRenderer. Undefined for main-agent views. */
  toolCallRef?: TurnToolCall;

  /** True for the orchestrator/main agent (no toolCallRef, sections-mode tools heading uses "Tools & Agents"). */
  isMainAgent: boolean;
}

export type SubagentActivityItem =
  | { kind: "reasoning"; key: string; sortKey: number; content: string; agentName?: string }
  | { kind: "tool";       key: string; sortKey: number; toolCall: TurnToolCall }
  | { kind: "pill";       key: string; sortKey: number; type: "intent" | "memory" | "read_agent"; label: string; toolCall: TurnToolCall }
  | { kind: "message";    key: string; sortKey: number; content: string; agentName?: string }
  | { kind: "nested-subagent"; key: string; sortKey: number; toolCall: TurnToolCall };
```

> Activity items use a **stable `key`** (e.g. `tool:${toolCallId}`, `reasoning:${parentId}:${ordinal}`, `message:${parentId}:${ordinal}`) so per-row expansion state survives live insertions. The previous `index` was display-position-derived and would smear expansion across rows during streaming updates.

### 3.1 Adapters (app-side)

Adapters live in `apps/desktop/src/composables/subagentView/`:

```ts
export function fromSubagentFullData(d: SubagentFullData): SubagentView;
export function fromAgentNode(n: AgentNode, opts: {
  parallelGroupLabel?: string;     // from useParallelAgentDetection
  sessionStartMs?: number;         // for live-duration of main agent in unified mode
  liveNowMs?: number;              // ticking ref for in-progress
}): SubagentView;
```

### 3.2 Activity-stream computation

`useSubagentActivities` is refactored to accept a **structural input** rather than `SubagentFullData` so both adapters can drive it without fake `AttributedMessage` synthesis:

```ts
export interface ActivityStreamInput {
  childTools: TurnToolCall[];
  childMessages: { content: string; agentDisplayName?: string }[];
  childReasoning: { content: string; agentDisplayName?: string }[];
}

export function buildSubagentActivities(input: ActivityStreamInput): SubagentActivityItem[];
```

The conversation adapter passes `SubagentFullData` fields directly. The agent-tree adapter wraps `AgentNode.messages: string[]` / `reasoning: string[]` as `{ content }[]`. Both produce stable keys.

## 4. Shared component contract

```
packages/ui/src/components/SubagentPanel/
  SubagentPanel.vue              # the unified body (single template; no display dispatcher)
  SubagentPanelHeader.vue        # icon + name + meta + close (internal)
  SubagentModelWarning.vue       # internal
  SubagentCollapsibleBlock.vue   # internal — used for Prompt + Output
  SubagentActivityStream.vue     # internal — chronological reasoning ⇢ tools ⇢ pills ⇢ messages
  SubagentPanelNav.vue           # public — prev/next footer (used by slide-out only)
  activities.ts                  # buildSubagentActivities (public)
  types.ts                       # SubagentView, SubagentActivityItem, etc.
  index.ts
```

There is no display-mode dispatcher and no second body component. The original
`stream`/`sections` split was removed after the two modes converged structurally —
keeping them around invited drift (sections kept losing model warnings, stream kept
losing the cross-turn source row, etc.). A single body cannot drift.

```vue
<SubagentPanel
  :view="view"
  :live-duration-ms="liveMs"
  :render-markdown="prefs.renderMd"
  :is-rich-rendering-enabled="(toolName) => prefs.isRichRenderingEnabled(toolName)"
  :full-results="loader.fullResults"
  :loading-results="loader.loadingResults"
  :failed-results="loader.failedResults"
  @close="..."
  @load-full-result="loader.loadFullResult($event)"
  @retry-full-result="loader.retryFullResult($event)"
  @select-subagent="hostSelectSubagent($event)"
/>
```

> No `usePreferencesStore` import inside `packages/ui` — hosts inject `renderMarkdown` and `isRichRenderingEnabled` via props.
>
> `@select-subagent` carries the nested-subagent `toolCallId`. Hosts decide what to do — conversation host calls `panel.selectSubagent(id)`; agent-tree host calls `ctx.selectNode(id)`. The shared component never navigates.

### 4.1 Body layout (single mode)

Header → optional model-warning → Description (intent-summary or description) → cross-turn Source row (when applicable) → Prompt collapsible → Failure block (when failed) → Output collapsible (joined messages or `resultContent`) → chronological Activity stream (reasoning / tools / pills / nested subagents).

Both hosts render exactly this. Per-row expansion within the activity stream keys on a stable activity-item `key`, not a display index, so streaming inserts do not smear expansion state.

### 4.2 Container chrome — host responsibility

`<SubagentPanel>` is **content only**: no `position: fixed`, no transition, no width clamps. Container chrome lives in two thin host wrappers:

- `apps/desktop/src/components/conversation/SubagentPanel.vue`
  - Provides slide-out container (`<Transition name="cv-panel">`, fixed positioning, top offset, prev/next nav slot, Esc/←/→ shortcuts).
  - Builds `SubagentView` from `SubagentFullData` via `fromSubagentFullData`.
  - Owns its own `useToolResultLoader`.

- `apps/desktop/src/components/agentTree/AgentTreeDetailPanel.vue`
  - Inline `<Transition name="detail-panel">` matching today's behaviour.
  - Reads `useAgentTreeContext()` for the selected `AgentNode` and the existing tool-result loader.
  - Builds `SubagentView` from `AgentNode` via `fromAgentNode`.

This split keeps `<SubagentPanel>` framework-only (no `useShortcut`, no fixed positioning, no app-store coupling) so it remains a pure `packages/ui` citizen.

## 5. Refresh & lifecycle semantics

Both call-sites refresh from the same store (`useSessionDetailContext().turns`). The shared component does **not** subscribe to the store — its host wrappers do. Required behaviour:

1. **Reactive recomputation** — `SubagentView` is `computed()` from `turns`. Any append/replace re-derives child tools/messages/reasoning and the activity stream.
2. **Lifecycle generation key** — hosts compute a composite generation key
   `${sessionId}|${eventsFileSize}|${turnIndexList}` (the turn list is the joined `turnIndex` values; size/mtime come from the store's freshness probe). Behaviour:
   - **Same generation**: do nothing.
   - **Same `sessionId`, key only appends turn indices**: preserve selection. Re-resolve `selectedSubagent` by `id` against the new `subagentMap` so reference-replaced tool calls still hit.
   - **Same `sessionId`, content replaced (replay reset, compaction)**: re-resolve by id; if the id is no longer present, close.
   - **`sessionId` changed**: close and clear all expansion + loader state.
3. **Auto-close on disappear** — falls out of step 2 (re-resolve fails ⇒ close).
4. **Tool-result loader scoped to session** — `useToolResultLoader(() => sessionId)` self-clears on session change. Hosts must ensure the loader **outlives** any conditionally-mounted body (mount loaders at the host wrapper level, never inside a `v-if` body — see Wave 71 "decomposition" memory). Wrappers themselves remain mounted; only their inner body is gated by `v-if`/`<Transition>`.
5. **Expansion state reset on subagent change** — keyed off `subagent.id` inside the shared bodies. Per-row state inside `SubagentPanelToolList` and `SubagentPanelActivityStream` keys on the activity item's stable `key`, not display index, so streaming inserts do not smear.
6. **Scroll reset** — `position: absolute` scroll containers live in the **host wrapper** (it owns the chrome). The host watches `subagent.id` and scrolls its container to the top on change. The shared component does not own scroll.
7. **Live duration** — when `status === 'in-progress'`, the host wraps `durationMs` with a `useLiveDuration()` ticker so the header re-renders every tick. The shared component just calls `formatLiveDuration` vs `formatDuration` based on `status`.

### 5.1 Failure modes — explicit handling

- **Truncated `resultContent`** — if `resultContent` ends with `…[truncated]` and no full result is cached, body shows "Load full result". Click ⇒ `@load-full-result(toolCallId)`.
- **Tool-result load failure** — when `failedResults.has(toolCallId)`, show "Failed — Retry"; emits `@retry-full-result(toolCallId)`.
- **No prompt extractable** — section is omitted entirely.
- **Empty activity stream** — stream mode shows prompt + output and nothing else; the activity divider is hidden (no "no activity" empty state).
- **Failed agents with no output** — sections mode shows the Failure block with `tc.error`; Output/Result/Reasoning sections are hidden when empty.
- **Main-agent view** (`isMainAgent === true`):
  - No model substitution warning.
  - No parent Result section (no `toolCallRef`).
  - No "Source" cross-turn-parent row.
  - Sections-mode tools heading is **"Tools & Agents"** (not "Tool Calls").
  - Duration falls back to `liveDuration(node)` from the host (turn-relative or session-relative).

## 6. Visual examples

### 6.1 `SubagentView` examples

**A. Healthy completed explore agent**

```ts
{
  id: "tool_call_abc",
  type: "explore",
  displayName: "Explore Agent",
  description: "Find auth flows in the codebase",
  status: "completed",
  model: "claude-sonnet-4.6",
  requestedModel: "claude-sonnet-4.6",
  modelSubstituted: false,
  durationMs: 14_320,
  totalTokens: 8_421,
  totalToolCalls: 7,
  turnIndex: 3,
  prompt: "Locate the JWT verification middleware...",
  resultContent: "Found `verifyJwt` in src/auth/middleware.ts:42 ...",
  messages: ["Done — found the middleware at src/auth/..."],
  reasoning: ["Need to grep for jwt.verify or similar..."],
  childTools: [/* 7 TurnToolCalls */],
  activities: [/* reasoning, grep, view, view, message */],
  toolCallRef: { /* parent tc */ },
}
```

**B. In-progress general-purpose agent (cross-turn)**

```ts
{
  id: "tool_call_xyz",
  type: "general-purpose",
  displayName: "Refactor Helper",
  status: "in-progress",
  durationMs: 47_200,        // ticking
  turnIndex: 2,
  sourceTurnIndex: 2,
  isCrossTurnParent: true,
  prompt: "...",
  resultContent: undefined,
  error: undefined,
  messages: [],              // no final message yet
  reasoning: ["Plan: 1) read files, 2) propose patches, 3) ..."],
  childTools: [/* 3 in-flight + 2 completed */],
  activities: [/* reasoning + 5 tool items */],
}
```

**C. Failed code-review with model substitution**

```ts
{
  id: "tool_call_def",
  type: "code-review",
  displayName: "Code Reviewer",
  status: "failed",
  model: "claude-haiku-4.5",
  requestedModel: "claude-opus-4.7",
  modelSubstituted: true,
  durationMs: 3_120,
  error: "Rate limit exceeded for opus tier — substituted with haiku and request still failed.",
  prompt: "Review the auth middleware change...",
  messages: [],
  reasoning: [],
  childTools: [],
  activities: [],
}
```

### 6.2 Layout sketches

```
┌── stream mode (conversation) ──────────────────────────┐
│ 🔍 Explore Agent · sonnet-4.6 · 14.3s · Turn 3   ✓     │
│ ──────────────────────────────────────────────────     │
│ Description: Find auth flows in the codebase            │
│ ┌─ Prompt ─────────────────────────────  [Collapse] ─┐ │
│ │ Locate the JWT verification middleware...           │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─ Output ─────────────────────────────────  [Expand]─┐ │
│ │ Found `verifyJwt` in src/auth/middleware.ts:42 …    │ │
│ └─────────────────────────────────────────────────────┘ │
│ ── Activity (5) ────────────────────────────────────── │
│ ▸ 💭 Thinking…                                          │
│ • grep "jwt.verify"  (24ms) ✓                          │
│ • view src/auth/middleware.ts  (12ms) ✓                │
│ 📋 report_intent — "Locating middleware"               │
│ ── final message ─────────────────────────────────────  │
│ Done — found the middleware at src/auth/...            │
│ ◀ Prev      2 / 7      Next ▶                          │
└────────────────────────────────────────────────────────┘
```

```
┌── sections mode (agent tree) ──────────────────────────┐
│ 🔍 Explore Agent                                   ✕   │
│ Description   Find auth flows in the codebase          │
│ Source        Launched in turn 3                       │
│ ┌─ Prompt ────────────────────────────────────────────┐│
│ │ Locate the JWT verification middleware...           ││
│ └─────────────────────────────────────────────────────┘│
│ Status: ✓ completed · Duration: 14.3s · Tools: 7       │
│ Model: sonnet-4.6                                       │
│ Tokens: 8,421                                           │
│ ── Output ─────────────────────────────────────────── │
│ Done — found the middleware at src/auth/...            │
│ ── Result ──────────────────────────────────────────── │
│ <ToolResultRenderer …>                                  │
│ ▸ 💭 1 reasoning block                                  │
│ ── Tool Calls (7) ──────────────────────────────────── │
│ 1. ▸ 🔎 grep "jwt.verify"     (24ms) ✓                 │
│ 2. ▸ 👁 view src/auth/middleware.ts (12ms) ✓           │
│ ...                                                     │
└────────────────────────────────────────────────────────┘
```

## 7. Open considerations

- **Pills in `sections` mode** — today the agent tree treats `report_intent` / `store_memory` / `read_agent` as ordinary tool rows. Stream mode treats them as pills. We keep current behaviour per mode; pill styling is opt-in via the activity stream.
- **Nested subagents** — stream mode renders a compact "nested subagent" row that links into the parent's selection flow. Sections mode shows them as ordinary rows in the tools list with an "agent" badge (current behaviour). Both are acceptable; selecting a nested subagent is a host concern (in agent tree it navigates the tree; in conversation it switches the slide-out subject via `useSubagentPanel.selectSubagent(id)`).
- **Token timeline** — out of scope here; remains in the dedicated token-timeline view. The header continues to surface only the aggregate `totalTokens`.
- **Replay mode** — the replay sidebar surfaces subagent info via `ReplayStepContent.vue` and is not consolidated by this change. Future work.

## 8. Migration plan

1. Land `packages/ui/src/components/SubagentPanel/*` (types + leaf components + dispatcher). No app imports.
2. Refactor `useSubagentActivities` → pure `buildSubagentActivities(input)` accepting structural input; keep a thin Vue-wrapper composable for the conversation host.
3. Add app-side adapters under `apps/desktop/src/composables/subagentView/` (`fromSubagentFullData`, `fromAgentNode`).
4. Add `ConversationSubagentPanel` host wrapper. Keep loader at the wrapper level (always-mounted; body is `v-if`).
5. Add `AgentTreeSubagentPanel` host wrapper. Reuse the loader already in `useTimelineToolState`.
6. Switch `ChatViewMode.vue` and `AgentTreeView.vue` to the new wrappers.
7. **Port** content from `apps/desktop/src/components/conversation/subagent/*` into the shared package one file at a time; only delete the old files after their consumers are gone.
8. Delete `SubagentPanel.vue` (conversation), `AgentTreeDetailPanel.vue`, and the absorbed `subagent/*` files. Update `scripts/check-file-sizes.mjs` allow-list if needed.
9. Run typecheck + targeted tests.

### 8.1 Targeted test additions

The risky part is lifecycle, not rendering. Add (or extend) tests for:

- Selection survives turn append (new turn pushed, same `id` resolved against new map).
- Selection survives store refresh that replaces tool-call object references with same ids.
- Panel closes on `sessionId` change.
- Panel closes when the selected `id` disappears (replay reset).
- In-progress duration ticks without resetting expansion state.
- Nested-subagent click in stream mode emits `@select-subagent` with the correct id.
- Truncated result triggers `@load-full-result`; failed result triggers `@retry-full-result`.
- Main-agent view renders without `toolCallRef` and uses "Tools & Agents" heading.
- Activity-row expansion is keyed by stable `key`, not index (insert a reasoning item before an expanded tool row → expansion stays on the original row).

The data utilities (`useCrossTurnSubagents`, `buildSubagentActivities`, `useToolResultLoader`, `agentTreeBuilder`) are otherwise unchanged.
