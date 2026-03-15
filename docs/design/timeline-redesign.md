# TracePilot Timeline Redesign — Design Document

## Problem Statement

The current `SessionTimelineView` has significant usability issues when rendering real Copilot CLI session data:

### Current Architecture
The timeline uses a **3-lane horizontal swimlane** layout:
- **User lane** — one block per user message
- **Assistant lane** — one block per assistant turn
- **Tools lane** — one block per tool call (flat, no hierarchy)

### Key Problems

| Problem | Impact | Root Cause |
|---------|--------|------------|
| **Tiny cluttered blocks** | Tool bars are 1-2px wide, unreadable | 1751 tool calls share one lane; each gets `100/N %` width |
| **Subagents invisible** | No way to see agent orchestration | Subagent events bundled into assistant lane; no dedicated visualization |
| **Temporal clustering** | Time-based positioning collapses events | 60% of gaps are <10ms; 79% are <100ms. Events cluster into a few pixels |
| **No hierarchy** | Can't see which tools belong to which subagent | `parentToolCallId` nesting ignored; all tools flattened into one lane |
| **Scale mismatch** | Mock data (3 turns) vs real data (335 turns) | Layout designed for small sessions; breaks at scale |
| **No collapsing** | Can't focus on areas of interest | 335 turns all rendered simultaneously with no grouping |
| **No parallel visualization** | Can't see concurrent subagent execution | Multiple subagents running simultaneously shown sequentially |

### Real Data Analysis

From analysis of actual Copilot CLI sessions at `~/.copilot/session-state/`:

```
Session: 561e810c (5182 events, 335 turns, 3 user messages, 131 min)

Event Type Distribution:
  tool.execution_start/complete:  1751 each (67.5%)
  assistant.message:               869 (16.8%)
  assistant.turn_start/end:        335 each (6.5%)
  subagent.started/completed:       44 each (1.7%)
  system.notification:              35 (0.7%)
  user.message:                      3 (0.1%)

Timing Distribution (gaps between events):
  < 10ms:     60.1%  ← most events are near-simultaneous
  10-100ms:   19.2%
  0.1-1s:      4.9%
  1-5s:        9.3%
  5-30s:       5.8%
  30s-2min:    0.5%
  > 2min:      0.1%  ← rare but dramatic gaps (user idle time)

Turn Complexity:
  Turn 7:  150 tools (1 top-level, 149 nested), 5 explore subagents
  Turn 13: 112 tools (1 top-level, 111 nested), 4 subagents (3 general-purpose + 1 explore)
  Average turn: ~5 tools (but highly bimodal — most turns are tiny, subagent turns are huge)

Subagent Internals (each explore subagent contains):
  ~150 internal tool calls (view, grep, glob, powershell)
  ~28 internal assistant messages
  0-2 inner turns
```

### Data Model Available

From `packages/types/src/index.ts` and `crates/tracepilot-core/src/models/`:

```typescript
interface ConversationTurn {
  turnIndex: number;
  turnId: string;
  userMessage: string | null;
  assistantMessages: string[];
  model: string;
  timestamp: string | null;
  endTimestamp: string | null;
  toolCalls: TurnToolCall[];
  durationMs: number | null;
  isComplete: boolean;
}

interface TurnToolCall {
  toolCallId: string;
  parentToolCallId: string | null;  // ← KEY: links to subagent parent
  toolName: string;
  arguments: unknown;
  success: boolean | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  mcpServerName: string | null;     // MCP tool distinction
  mcpToolName: string | null;
  isComplete: boolean;
}

// Raw events also available via getSessionEvents():
interface SessionEvent {
  eventType: string;   // 24 types including subagent.started/completed/failed
  timestamp: string;
  id: string;
  parentId: string | null;  // event tree structure
  data: unknown;
}
```

Subagent events carry: `toolCallId`, `agentName`, `agentDisplayName`, `agentDescription`.

---

## Proposed Designs

### Design A: Flame Chart Timeline

**Inspiration:** Chrome DevTools Performance tab, speedscope, Jaeger trace viewer

**Concept:** Horizontal flame chart where depth = hierarchy level. The session is the top-level frame, turns are children, tool calls and subagents are nested below.

```
Depth 0: ████████████████████ Session ████████████████████████
Depth 1: ██ Turn 1 ██  ░░  ████████ Turn 2 ████████  ░░  ██ Turn 3 ██
Depth 2: █ report █ task █ task █  █ report █ task █ task █ task █
Depth 3:          └ view  └ grep   └ view   └ edit └ grep
Depth 4:          └ grep  └ view              └ powershell
```

**Strengths:**
- Natural representation of hierarchical data (turns → tools → subagent internals)
- Familiar UX pattern for developers (devtools)
- Handles temporal clustering gracefully (width = duration, not absolute time)
- Zoom + pan for navigation
- Subagents clearly visible as wide frames containing their children

**Weaknesses:**
- Can be overwhelming at full scale (5000+ frames)
- Requires good zoom/pan UX to be usable
- Not as intuitive for non-developer users

**Data requirements:** `ConversationTurn[]` with `toolCalls[]` and `parentToolCallId` chain. Also needs `SessionEvent[]` for subagent start/complete events (to get agent names).

**Prototype:** `prototypes/components/timeline-flame-chart.html`

---

### Design B: Nested Swimlanes

**Inspiration:** Gantt charts with nested task groups, GitHub Projects timeline view

**Concept:** Keep the swimlane metaphor but make it hierarchical and collapsible. Each turn is a collapsible group with its own lanes for subagents.

```
┌─ Turn 1 (52min, 150 tools, 5 subagents) ──────────── [−] ─┐
│ User      │ ████ "Explore the codebase"                     │
│ Assistant │ ████████████████████████████████████              │
│ ┌─ explore #1 (25s, 8 tools) ──┐                            │
│ │  view ██ grep ██ view ██     │                             │
│ └──────────────────────────────┘                             │
│ ┌─ explore #2 (22s, 6 tools) ──┐  ← parallel               │
│ │  grep ██ view ██ view ██     │                             │
│ └──────────────────────────────┘                             │
│ Direct tools │ report_intent █ read_agent ██                 │
└──────────────────────────────────────────────────────────────┘
```

**Strengths:**
- Intuitive "drill-down" UX — collapsed by default, expand to see detail
- Subagents get their own labeled lanes with type/color coding
- Handles scale well — 335 turns collapsed = 335 rows with summary badges
- Direct mapping to the data model hierarchy
- Distinguishes "direct tools" (report_intent, sql) from "subagent-nested tools"

**Weaknesses:**
- Can get very tall when expanded (many subagents per turn)
- Parallel execution harder to show than in flame chart
- Horizontal time axis less precise than flame chart

**Data requirements:** `ConversationTurn[]` with `toolCalls[]`, `parentToolCallId`, plus subagent event data for agent names/types.

**Prototype:** `prototypes/components/timeline-nested-swimlanes.html`

---

### Design C: Turn Waterfall

**Inspiration:** Chrome Network tab waterfall, Jaeger span detail view

**Concept:** Focus on ONE turn at a time with a detailed waterfall view showing all tool calls with timing bars, nesting, and parallel execution.

**Strengths:**
- Maximum detail for complex turns (150+ tool calls become navigable)
- Clear parallel execution visualization (concurrent bars at same time offset)
- Tree-style nesting with indent levels
- Turn navigation (prev/next/jump) handles the 335-turn scale
- Works even when timestamps cluster (<10ms gaps rendered as sequential)

**Weaknesses:**
- Loses the "whole session at a glance" view
- Requires additional navigation UX (turn selector)
- Best paired with another view for session-level context

**Data requirements:** `ConversationTurn[]` with full `toolCalls[]` timing data.

**Prototype:** `prototypes/components/timeline-turn-waterfall.html`

---

### Design D: Session Overview + Heatmap

**Inspiration:** GitHub contribution graph, Grafana dashboards, Strava activity heatmap

**Concept:** Macro-level view showing the entire session as phases (split by user messages) with activity heatmaps, subagent Gantt charts, and tool type breakdowns.

**Strengths:**
- "Big picture" view that no other design provides
- Automatically segments session into meaningful phases
- Activity heatmap reveals patterns (burst → idle → burst)
- Subagent Gantt shows orchestration across the whole session
- Good entry point — click a phase to drill into detail

**Weaknesses:**
- Not useful for inspecting individual tool calls
- Heatmap requires canvas rendering for performance
- Must be paired with a detail view

**Data requirements:** `ConversationTurn[]`, `SessionEvent[]` (for timing/density), shutdown metrics for model info.

**Prototype:** `prototypes/components/timeline-session-overview.html`

---

### Design E: Agent Orchestration Tree

**Inspiration:** Kubernetes pod/node diagrams, distributed system trace viewers

**Concept:** Tree/graph visualization showing the main agent spawning subagents, with each node showing status, duration, and tool count. Focused view for understanding the agent delegation pattern.

**Strengths:**
- Makes subagent orchestration the primary focus
- Clear parent-child relationships
- Shows parallel execution groups
- Good for understanding "what did the AI delegate to whom?"
- Click-to-drill into any agent's tool calls

**Weaknesses:**
- Only useful for turns that have subagents
- Doesn't show the full session timeline
- Tree layout can be complex for many nodes

**Data requirements:** `ConversationTurn.toolCalls[]` with `parentToolCallId`, plus `SessionEvent[]` for `subagent.started/completed` events.

**Prototype:** `prototypes/components/timeline-agent-tree.html`

---

## Recommended Approach: Composite View

No single design handles all use cases. We recommend a **3-level composite approach**:

### Level 1: Session Overview (Design D)
- Default landing view for the Timeline tab
- Shows full session as phases with heatmap and subagent Gantt
- Click a phase → zoom into Level 2

### Level 2: Nested Swimlanes (Design B) OR Flame Chart (Design A)
- Shows all turns within a phase with collapsible subagent lanes
- Both designs serve this level well; flame chart is more developer-friendly, nested swimlanes are more approachable
- Click a turn → zoom into Level 3

### Level 3: Turn Waterfall (Design C) + Agent Tree (Design E)
- Detailed view of a single turn
- Waterfall shows timing; Agent Tree shows orchestration
- Tab toggle between the two views

### Navigation Pattern
```
Session Overview → [click phase] → Phase Swimlanes → [click turn] → Turn Detail
     ↑                                   ↑                              ↑
  Level 1                             Level 2                        Level 3
  (macro)                           (mid-level)                     (micro)
```

This mirrors the actual data hierarchy: **Session → Phases → Turns → Tool Calls/Subagents**

---

## Implementation Considerations

### Data Pipeline Changes

The current `getSessionTurns()` returns `ConversationTurn[]` which is sufficient for most views, but we'll need:

1. **Phase segmentation** — Group turns by user messages (turns between consecutive `user.message` events form a phase). This can be computed client-side.

2. **Subagent metadata enrichment** — Currently `TurnToolCall` has `parentToolCallId` but NOT the agent type/name. We need to correlate with `subagent.started` events via `toolCallId`. Options:
   - Add `agentName`/`agentType` fields to `TurnToolCall` in the Rust turn reconstruction
   - Fetch `SessionEvent[]` separately and correlate client-side
   - **Recommended:** Enrich in Rust (option 1) — cleaner data contract

3. **Parallel group detection** — Identify which subagents ran concurrently. Algorithm: sort subagent start/end timestamps, find overlapping intervals.

4. **Event density computation** — For the heatmap, compute events-per-second across the session timespan. Can be done server-side (Rust) or client-side with `SessionEvent[]` timestamps.

### Performance

- **Virtualization** required for 335+ turn lists (vue-virtual-scroller or custom)
- **Canvas rendering** for heatmap strip (not DOM elements)
- **Lazy loading** — Load turn details on demand, not all 335 turns at once
- **Web Workers** — Compute flame chart layout off-main-thread for 5000+ events

### New TypeScript Types Needed

```typescript
// Phase grouping
interface SessionPhase {
  phaseIndex: number;
  userMessage: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  turns: ConversationTurn[];
  turnCount: number;
  toolCallCount: number;
  subagentCount: number;
  dominantModel: string;
}

// Enriched tool call with subagent info
interface EnrichedToolCall extends TurnToolCall {
  agentName?: string;
  agentType?: 'explore' | 'general-purpose' | 'code-review' | 'task';
  agentDisplayName?: string;
  nestedToolCalls?: EnrichedToolCall[];  // resolved tree
  isSubagentContainer: boolean;
}

// Flame chart frame
interface FlameFrame {
  id: string;
  label: string;
  type: 'session' | 'phase' | 'turn' | 'tool' | 'subagent' | 'message';
  depth: number;
  startMs: number;
  durationMs: number;
  color: string;
  children: FlameFrame[];
  metadata: Record<string, unknown>;
}

// Activity density for heatmap
interface ActivityDensity {
  bucketStartMs: number;
  bucketEndMs: number;
  eventCount: number;
  toolCallCount: number;
  subagentCount: number;
}
```

### Rust-Side Changes

In `crates/tracepilot-core/src/turns/mod.rs`, the `reconstruct_turns()` function should be extended to:
1. Tag tool calls with their subagent context (agent_name, agent_type)
2. Build the parent-child tree (currently flattened with just `parentToolCallId`)
3. Compute parallel groups for subagents

---

## Prototype Index

| Prototype | File | Description |
|-----------|------|-------------|
| Flame Chart | `timeline-flame-chart.html` | Hierarchical depth-based flame visualization |
| Nested Swimlanes | `timeline-nested-swimlanes.html` | Collapsible turn groups with subagent lanes |
| Turn Waterfall | `timeline-turn-waterfall.html` | Detailed single-turn waterfall with nesting |
| Session Overview | `timeline-session-overview.html` | Macro session view with heatmap and phases |
| Agent Tree | `timeline-agent-tree.html` | Tree visualization of agent orchestration |

All prototypes use the TracePilot Variant C design system (`design-system-c.css`) and are fully self-contained HTML files with inline JavaScript for interactivity.

---

## Open Questions

1. **Flame chart vs nested swimlanes for Level 2?** — Both serve the mid-level view. Flame chart is more compact but less familiar to non-devs. Could offer both as a toggle.

2. **Should we enrich tool calls in Rust or correlate client-side?** — Rust enrichment is cleaner but requires backend changes. Client-side correlation works with existing API but adds latency.

3. **How to handle sessions with no subagents?** — Simpler sessions (no `task()` calls) should degrade gracefully — the nested swimlane just shows flat tool calls without subagent grouping.

4. **Virtual scrolling strategy?** — Need to decide between vue-virtual-scroller (maintained, integrates with Vue) vs custom implementation for the flame chart canvas.

5. **Should the overview heatmap use events or turns for density?** — Events give higher resolution but require fetching all events (potentially 5000+). Turns are already loaded but coarser.
