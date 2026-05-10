# 14 · Session Timeline — swimlane + waterfall

> **Scope:** The Session Timeline inner tab — the page that turns a session into a
> visual trace. Two co-equal renderings (swimlane and waterfall) sharing one ruler
> and one span primitive. This is the flagship view of TracePilot; this spec exists
> to stop the chrome from undermining it.
>
> **Inherits:** `00-globals.md` (all hygiene rules — G1…G10), `01-chrome.md` (page
> header / `<ToolbarRow>` semantics), `02-primitives.md` (`<Heading>`,
> `<StatusPill>`, `<EmptyState>`, `<ToolbarRow>`), `11-session-detail-shell.md`
> (the `<SegmentedControl>` proposal — used here, not redefined).
>
> **Audit closes:** UI-AUDIT lines **83–89** (Session Timeline view) and **329–333**
> (Timeline Sub-Views) — emoji empty state (CC-1), GitHub Primer hex literals at
> `SessionTimelineView.vue:96–97` (G6/CC-11), divergent time-axis treatment across
> the three sub-views (CC-9), and an undersold flagship feature whose chrome
> competes with its data.
>
> **Sources read:**
> - `apps/desktop/src/views/SessionTimelineView.vue`
> - `apps/desktop/src/components/timeline/NestedSwimlanesView.vue`
> - `apps/desktop/src/components/timeline/TurnWaterfallView.vue`
> - `apps/desktop/src/components/timeline/AgentTreeView.vue`
> - `apps/desktop/src/components/timeline/swimlanes/SwimlaneTurnGroup.vue`
> - `apps/desktop/src/components/timeline/swimlanes/SwimlaneSubagentLane.vue`
> - `apps/desktop/src/components/timeline/swimlanes/SwimlaneMessageLane.vue`
> - `apps/desktop/src/components/timeline/swimlanes/SwimlanePhaseGroup.vue`

---

## 14.1 · Information architecture

The Timeline view answers one question: **what happened in this session, and
when**. Everything in the chrome is in service of that single read.

| Concept | Definition |
|---|---|
| **Turn** | A user prompt and the agent work that follows it. Turns are the top-level chronological unit. |
| **Swimlane** | A horizontal track per agent identity. The main agent owns lane 0; each spawned sub-agent gets its own lane underneath, indented under the turn that spawned it. |
| **Span** | A single tool call (or a sub-agent invocation, which contains child spans). Has a start, a duration, and an outcome. Selectable. |
| **Ruler** | The shared time axis at the top of the canvas. Linear by default; toggleable to log when the duration distribution is wide. Tick marks every 100ms / 1s / 10s as zoom dictates. |
| **Waterfall** | A second rendering of the *same* spans, expanded into a per-turn gantt: rows are tool calls, x is time-since-turn-start, depth is parent/child nesting. |

The Timeline tab presents these in **one canvas** with a single view toggle —
not three divergent visualisations. The previous Agent Tree view is deprecated;
its information (parent/child agent relationships) is folded into the swimlane
indentation and into the per-span inspector.

**Persistence.** The view choice (`swimlane` | `waterfall`) is persisted **per
session id** under `tracepilot:timeline:view:<sessionId>`. A user who opens the
same trace twice gets the same view. The default for a session never seen
before is `swimlane`. Ruler scale (`linear` | `log`) is persisted globally
under `tracepilot:timeline:scale`.

---

## 14.2 · Layout — ASCII wireframes

Two wireframes, one per view. Both share the same outer shell: a single
`<ToolbarRow>` band with the view toggle on the right, then the canvas. **No
page-level `<h1>`** — the `<PageHeader>` from `11-session-detail-shell.md`
already supplies the title and breadcrumb. The duplicate "Session Timeline" /
"Visual timeline of session events and interactions" subtitle from
`SessionTimelineView.vue:42–43` is removed.

### (a) Swimlane view

```
┌── ToolbarRow ──────────────────────────────────────────────────────────────┐
│ Turns ▾  Tool ▾  Agent ▾                       [linear|log] [ swim │ wave ]│
├── Ruler (sticky) ──────────────────────────────────────────────────────────┤
│            0s        2s        4s        6s        8s        10s          │
│            ╷         ╷         ╷         ╷         ╷         ╷            │
├────────────────────────────────────────────────────────────────────────────┤
│ ▼ Turn 1 · "refactor auth"          18:42:01 · 8.3s · 12 calls · 1 sub    │
│   ┃ main      ████ read  ██ glob   ████████ edit            ▒▒ done      │
│   ┃ ⌙ explore         ██████ search   ████ read  ██ read                  │
│                                                                            │
│ ▼ Turn 2 · "fix crash on resume"    18:42:14 · 4.1s · 6 calls            │
│   ┃ main      ██ read   ██████ task▶                       ▒ done        │
│   ┃ ⌙ task               ████████████ bash  ▓▓▓ ! error                  │
│                                       ▲                                   │
│                                       └─ hover ─┐                         │
│                                ┌────────────────┴───────────────┐         │
│                                │  bash · 1.2s · exit 1          │tooltip  │
│                                │  npm test --workspace=ui       │elev.3   │
│                                │  Enter to pin · → next span    │         │
│                                └────────────────────────────────┘         │
│ ▶ Turn 3 · "ship" (collapsed)       18:42:20 · 2.0s · 3 calls            │
└────────────────────────────────────────────────────────────────────────────┘
```

Notes on (a):

- The ruler is rendered once at the top and remains sticky inside the scroll
  region. It is **not** glass; it is `--canvas-subtle` with a `--border-subtle`
  bottom hairline (cf. 00-globals §G2 replacement recipes).
- Lane labels (`main`, `⌙ explore`, `⌙ task`) live in a 160px gutter on the
  left. They are flat text in `--text-secondary` — **no gradient fills, no
  pills**. The lane's agent identity is encoded by the 2px-wide leading bar
  (`┃`) coloured from `--agent-color-*` (§14.4).
- Span bars inherit hue from the lane's `--agent-color-*` and are tinted by
  outcome at 100% saturation only at the right cap (`▒` for done, `▓ !` for
  error). The bar fill itself is the agent colour at 70% alpha against
  `--canvas-default`; this keeps neighbouring lanes legible without resorting
  to outlines on every span.
- Sub-agent lanes are indented one step (`⌙` glyph + 12px) under the turn that
  spawned them. Indent never exceeds 2 levels — deeper trees collapse with a
  `+N` chip and open in the inspector.

### (b) Waterfall view

```
┌── ToolbarRow ──────────────────────────────────────────────────────────────┐
│ Turn 2 of 14    ◀ prev    [ Turn 2: "fix crash on resume" ▾ ]    next ▶   │
│                                                 [linear|log] [ swim │ wave ]│
├── Ruler (sticky, turn-relative) ──────────────────────────────────────────┤
│ Name                       0      500ms    1.0s    1.5s    2.0s    2.5s   │
│ ────────────────────────── ╷───────╷───────╷───────╷───────╷───────╷───── │
│ ▸ read  src/auth.ts        ██                                             │
│ ▸ task  refactor-helper      ████████████████████████                     │
│   ▸ bash  npm test                ▓▓▓▓▓▓▓▓▓▓▓▓ ! exit 1                  │
│   ▸ read  package.json                          ██                        │
│   ▸ edit  src/auth/jwt.ts                          ██████                 │
│ ▸ edit  src/auth.ts                                       ████            │
│ ▸ Assistant response                                            ▒▒▒       │
│                                                                            │
│        ┌─ hover (sub-pixel cluster) ───────────────────┐                  │
│        │  +4 spans clustered here · zoom in or         │                  │
│        │  press 0 to fit · → step into                 │                  │
│        └───────────────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Notes on (b):

- The ruler is **turn-relative** in waterfall mode (origin = turn start), not
  wall-clock — this is the single intentional difference from swimlane. The
  ruler primitive accepts an `origin` prop so the same component renders both
  modes.
- Row depth is encoded by indentation only; the `▸` chevron toggles
  expand/collapse for sub-agent rows. No background-tint stripes on alternate
  rows — they fight the span colour.
- The hover tooltip in both views is positioned **above** the cursor when
  there is room, **below** otherwise; never overlapping the span itself.
  Tooltip elevation: `--shadow-md` (`elev.3`), background `--canvas-overlay`,
  border `--border-default`. **No backdrop-filter** (G2).

---

## 14.3 · Tokens used

All colour comes from tokens. No hex appears in the component CSS (G6).

### Lane / span hue (categorical)

Per MASTER §2.4. Each lane is bound to one token by agent identity; the order
is fixed and **must not be reassigned**:

| Lane / span family | Token | Bound to |
|---|---|---|
| Main agent | `--agent-color-main` | the orchestrating CLI session |
| Explore sub-agent | `--agent-color-explore` | explore tasks |
| General-purpose sub-agent | `--agent-color-general-purpose` | general-purpose tasks |
| Code-review sub-agent | `--agent-color-code-review` | code-review tasks |
| Rubber-duck sub-agent | `--agent-color-rubber-duck` | rubber-duck tasks |
| Task sub-agent | `--agent-color-task` | generic task subagent |
| 7th distinct lane (overflow) | `--chart-info` | first non-canonical lane |
| 8th distinct lane (overflow) | `--chart-lime` | second non-canonical lane |

Beyond eight, lanes round-robin back to index 0 with a 1px dashed top border
to disambiguate — this is rare enough to be acceptable.

### Outcome (state, not categorical)

Outcome **always** uses semantic state tokens (MASTER §2.3). Never use a
categorical colour to encode pass/fail.

| Outcome | Token | Encoding on a span |
|---|---|---|
| Pass / completed | `--success-fg` | right-cap chip + `check-circle-2` icon |
| Slow / soft-failure / retry | `--warning-fg` | right-cap chip + `alert-triangle` icon |
| Error | `--danger-fg` | full-bar tint at 60% alpha + `x-circle` icon |
| Cancelled / skipped | `--neutral-fg` | hatched fill + `minus-circle` icon |
| Closed / done (terminal, not pass) | `--done-fg` | right-cap chip only |

### Grid, ruler, neutral chrome

| Surface | Token |
|---|---|
| Canvas background | `--canvas-default` |
| Sticky ruler band, info bar, lane gutter | `--canvas-subtle` |
| Span hover ridge, selected lane row | `--surface-tertiary` |
| Tooltip / pinned inspector overlay | `--canvas-overlay` |
| Ruler ticks, lane separators | `--border-subtle` |
| Selected-span outline | `--border-accent` |
| Tick labels (mono, 11/14) | `--text-tertiary` |
| Lane labels | `--text-secondary` |
| Active turn header | `--text-primary` |

### Selection / focus

Selected span: 1px solid `--border-accent` outline + `--accent-subtle` halo.
Focus ring follows 00-globals §G4 verbatim (2px `--accent-emphasis`, 2px
offset). Selection survives view toggle — `swim` ↔ `wave` keeps the same span
selected and scrolls it into view.

---

## 14.4 · Component contracts

The Timeline view is a composition of existing primitives plus one shared
internal layout primitive (`<TimelineRuler>` / `<SpanBar>` — exported from
`packages/ui` so swimlane and waterfall share the same code path, closing the
audit's CC-9 finding on divergent axis treatment).

### From `02-primitives.md`

- **`<ToolbarRow>` (§02-primitives 10).** One band at the top. Left slot:
  filter chips (Turns / Tool / Agent). Right slot: ruler-scale toggle and the
  view toggle. `:sticky="true"` so the toolbar pins under the inner-tab strip
  from `11-session-detail-shell §11.4`.
- **`<Heading>` (§02-primitives 1).** Used **only** for the empty-state title
  inside `<EmptyState>`. The page title comes from the shell, not from this
  view.
- **`<StatusPill>` (§02-primitives 8).** Per-turn header summary chip ("12
  calls · 1 sub-agent · 8.3s"). Tone: `success` when all spans pass,
  `warning` if any span warns, `danger` if any span errors — never colour-only,
  always paired with the matching Lucide icon.
- **`<EmptyState>` (§02-primitives 9).** Replaces the current
  `EmptyState icon="📊"` (CC-1). Use `iconName="bar-chart-3"` (Lucide), not
  emoji. Title `"No timeline data"`, message `"This session has no
  conversation turns to visualise."`, primary action `"Refresh session"`.

### From `11-session-detail-shell.md`

- **`<SegmentedControl>` (§11.4 — proposed primitive).** This is the view
  toggle. Two options: `{ value: 'swimlane', label: 'Swimlane', iconName:
  'rows-3' }`, `{ value: 'waterfall', label: 'Waterfall', iconName: 'bar-chart-horizontal' }`.
  `ariaLabel="Timeline rendering"`. **Reuse the same primitive** the inner-tab
  strip uses — do not introduce a `BtnGroup` here. The current
  `<BtnGroup>` import in `SessionTimelineView.vue:2` is removed when
  `<SegmentedControl>` lands.

### Proposed view-local primitives (added to `packages/ui`)

The audit's CC-9 finding is that the three sub-views diverge in their
time-axis treatment. The fix is to extract two small primitives so swimlane
and waterfall **cannot drift**:

```ts
// packages/ui/src/components/TimelineRuler.vue
interface TimelineRulerProps {
  /** Total time span the ruler covers, in milliseconds. */
  spanMs: number;
  /** Origin label semantics. 'epoch' → wall-clock; 'turn-start' → relative. */
  origin: 'epoch' | 'turn-start';
  scale: 'linear' | 'log';
  /** Pixel width of the bar column the ruler aligns with. */
  trackWidthPx: number;
  /** Sticky inside the parent scroll region. */
  sticky?: boolean;
}

// packages/ui/src/components/SpanBar.vue
interface SpanBarProps {
  startMs: number;            // relative to ruler origin
  durationMs: number;
  agentToken: AgentColorToken; // '--agent-color-main' | …
  outcome: 'pass' | 'warn' | 'error' | 'cancelled' | 'done';
  label: string;
  selected?: boolean;
  /** When the resolved width < 1px, SpanBar clamps to 1px and exposes
   *  `clusterCount` for the parent to render the "+N" chip (§14.7). */
  clusterCount?: number;
}
```

Both views consume these. Lint rule (extends
`tracepilot/no-local-reimplementation` from §02-primitives): any
`apps/desktop/src/**/*.vue` outside the timeline barrel that defines
`.ruler-track`, `.ruler-tick`, `.span-bar` selectors fails the build.

### Tooltip primitive

`02-primitives.md` does not yet define a tooltip. Span hover requires one;
this spec proposes the minimal contract so the timeline can ship without
inlining a hand-rolled popover (which would re-introduce backdrop-filter
and bespoke z-index — both flagged in 00-globals).

```ts
// packages/ui/src/components/Tooltip.vue — [NEW PRIMITIVE proposed here]
interface TooltipProps {
  /** Anchor element ref or selector. */
  anchor: HTMLElement | string;
  /** Preferred placement; flips automatically when off-screen. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Open delay in ms (default 120 — matches G5 micro). */
  openDelay?: number;
  /** Inert tooltip = no pointer events; pinned tooltip becomes a popover. */
  pinned?: boolean;
}
```

Surface: `--canvas-overlay` background, 1px `--border-default`,
`--shadow-md`, radius `--radius-md`, max-width 320px, `--z-tooltip`. **Never**
`backdrop-filter`. Tooltip text uses `--text-primary` for the title row and
`--text-tertiary` for the metadata row (mono, `tnum`).

When the tooltip is pinned (Enter), it upgrades to a `role="dialog"` and
gains focus — that's how the user reaches the inspector content with the
keyboard alone.

---

## 14.5 · Interaction model

The Timeline is keyboard-first. Pointer is supported but never required.
Every binding is registered through `useShortcut` so it surfaces in the `?`
overlay's *Active View* group (per 11-session-detail-shell §11.6 contract).

| Key | Action | Notes |
|---|---|---|
| `←` / `→` | Pan the canvas by 1 ruler tick | Hold `Shift` to pan by 5 ticks |
| `+` / `=` | Zoom in (canvas centred on selection or viewport centre) | |
| `-` | Zoom out | |
| `0` | Zoom to fit (entire session for swimlane; entire turn for waterfall) | Also clears any pan offset |
| `j` / `k` | Move selection to next / previous span in chronological order | Crosses lanes; respects collapsed sub-agents |
| `J` / `K` | Move selection to next / previous span **in the same lane** | |
| `Enter` | Pin the hovered or selected span — opens the inspector | `Esc` unpins |
| `` ` `` (backtick) | Toggle ruler scale `linear` ↔ `log` | Persisted globally |
| `s` | Switch to swimlane view | Persisted per session id |
| `w` | Switch to waterfall view | Persisted per session id |
| `[` / `]` | Previous / next turn (waterfall mode only) | Swimlane mode shows all turns at once |
| `c` | Collapse / expand the focused turn group (swimlane) or sub-agent row (waterfall) | |
| `Esc` | If a span is pinned: unpin. Else: clear selection. Else: focus the toolbar. | |

Pan and zoom are implemented as `transform: translateX()` / `scaleX()` on
the bar layer — never as width/left mutations on individual spans (G5). The
ruler's tick labels re-flow under the transform via a `ResizeObserver`-driven
tick recomputation, not via animated text.

Pointer model: drag-to-pan on the bar area (cursor: grab → grabbing); wheel
+ `Cmd/Ctrl` to zoom around the cursor; click to select; double-click to
pin; right-click to open a context menu (Copy span ID · Copy as cURL · Jump
to Conversation).

---

## 14.6 · States

| State | Behaviour |
|---|---|
| **Empty** | `<EmptyState iconName="bar-chart-3" title="No timeline data" message="This session has no conversation turns to visualise." actionLabel="Refresh session" />`. No emoji. |
| **Loading** | `<LoadingOverlay>` while turns load (existing primitive). Once the first turn arrives, the canvas renders incrementally — do **not** withhold the canvas pending the full load. |
| **Error** | Inline banner at the top of the canvas: `--danger-subtle` background, `--danger-fg` text, `<Icon name="alert-triangle" />`, retry button. Does not replace the canvas if any turns already streamed in — partial data stays visible. |
| **Partial-stream / live** | A session that is still running shows a 2px-wide pulsing edge on the right of the canvas in `--success-fg` at 60% alpha; the pulse honours `prefers-reduced-motion` (becomes a static line). New spans append at the right; auto-pan-to-latest is **off by default** (announced via a small `<StatusPill tone="info">Live · jump to latest</StatusPill>` chip in the toolbar that, when activated, scrolls to the leading edge). |
| **Zoom-too-far (sub-pixel spans)** | When a span's resolved width is less than 1px, `SpanBar` clamps it to 1px and stacks neighbouring sub-pixel spans into a **cluster** rendered as a single 1px line with a `+N` count chip on hover. The chip is `--surface-tertiary` background, `--text-secondary`, mono, `tnum`. Pressing Enter on the cluster opens the inspector with the cluster's spans listed. The visible message is `"+N spans clustered here · zoom in or press 0 to fit"`. |
| **No turns match filter** | Canvas stays mounted; an inline overlay says `"No spans match the active filter"` with a clear-filters button. The toolbar's filter chips remain interactive. |

---

## 14.7 · Motion

Per 00-globals §G5:

- Pan and zoom animate `transform` only, 120ms `cubic-bezier(0.2, 0.6, 0.2, 1)`.
  Continuous pan (held arrow key) uses no transition — direct transform per
  frame.
- View-toggle (`s` ↔ `w`) cross-fades the bar layer at 180ms `opacity`-only;
  the ruler is shared and does not re-render.
- Tooltip enter: 120ms `opacity` 0 → 1, no `translate`/`scale`. Exit: 80ms.
- Live-stream edge: 1.6s gentle pulse on `opacity` between `.45` and `.85`. **This
  is the one continuous animation in the view**, and it self-cancels under
  `prefers-reduced-motion: reduce` to a static `opacity: .65`.
- **No** `infinite` keyframes anywhere else. **No** layout-shifting hover —
  span hover changes border colour and adds the ridge via `box-shadow:
  inset 0 0 0 1px var(--border-emphasis)`, never `transform: scale`.
- `prefers-reduced-motion: reduce` collapses pan/zoom transitions to instant
  and disables the cross-fade (view toggle becomes a swap).

---

## 14.8 · Accessibility

The Timeline is a chart; the audit's MASTER §6 checklist requires a textual
fallback.

- **Canvas root** is `role="region" aria-label="Session timeline"` with
  `aria-describedby="timeline-summary"`.
- **`<TimelineSummary>`** is a visually-hidden `<dl>` mounted as a sibling
  containing:
  - Total session duration (text + mono `tnum`).
  - Turn count, total span count, sub-agent count.
  - Top-N longest spans (default N = 5): label, agent, duration, outcome.
  - Outcome distribution: pass / warn / error / cancelled counts.
  - Updated whenever the underlying data changes; `aria-live="polite"` so
    screen readers hear the update as the session streams.
- **Span navigation** is via arrow keys (§14.5). Each focused span announces
  `<agent> · <tool> · <duration> · <outcome>` through the existing live region
  (`useAnnouncer`). The active span gets `aria-current="true"`.
- **Non-colour encoding for outcome.** Every span carries a Lucide outcome
  icon at the right cap (`check-circle-2` / `alert-triangle` / `x-circle` /
  `minus-circle`). Outcome label is also part of the span's
  `aria-label` — colour is **never** the only signal (MASTER §5).
- **Lane identity** is announced as a label at the start of every focus
  movement that crosses a lane: "Lane 2 of 4 · Explore sub-agent".
- **Ruler ticks** are decorative (`aria-hidden="true"`); the durations they
  encode are surfaced in span labels and in the summary. The scale toggle is
  `<button aria-pressed>` with the current scale in the label.
- **Zoom level** is exposed on the canvas root as `aria-valuenow` (1× …
  256×) so screen readers announce zoom changes.

Contrast: lane hue at 70% alpha on `--canvas-default` passes 3:1 for
non-text contrast (WCAG 1.4.11). The right-cap outcome icon sits on a
solid `--success-fg` / `--warning-fg` / `--danger-fg` chip and uses
`--text-on-emphasis` for the icon stroke.

---

## 14.9 · Anti-patterns to remove

Specific to this view, in addition to the global rules in 00-globals.

| Where | What | Rule | Replacement |
|---|---|---|---|
| `SessionTimelineView.vue:96` | `background: var(--canvas-raised, #161b22)` — `#161b22` is **GitHub Primer**, not TracePilot zinc | G6 / CC-11 | `background: var(--canvas-subtle);` (info bar is inline chrome, not a raised card) |
| `SessionTimelineView.vue:97` | `border: 1px solid var(--border-default, #30363d)` — `#30363d` is **GitHub Primer** | G6 / CC-11 | `border: 1px solid var(--border-subtle);` |
| `SessionTimelineView.vue:36`, `NestedSwimlanesView.vue:160`, `TurnWaterfallView.vue:199` | `EmptyState icon="📊"` | G1 / CC-1 | `<EmptyState iconName="bar-chart-3" />` via the Lucide-bound `<Icon>` wrapper |
| `SessionTimelineView.vue:42–43` | Page title `<h1>` + subtitle inside the view body | 11-session-detail-shell §11.1 | Remove. The shell already supplies the title; the subtitle is content-free filler. |
| `SessionTimelineView.vue:2` | `BtnGroup` for view toggle | 11-session-detail-shell §11.4 | `<SegmentedControl>` |
| `TurnWaterfallView.vue:273` | `<span class="tool-icon">💬</span>` in the assistant-response row | G1 | `<Icon name="message-circle" size="16" />` |
| Any swimlane label | Gradient or pill-style fill on the lane gutter | G3 / CC-3 | Flat text + 2px leading bar in `--agent-color-*`. No `linear-gradient`. |
| Ruler track | `backdrop-filter` to "lift" the sticky ruler over content | G2 | `--canvas-subtle` + `--border-subtle` hairline. No blur. |
| Span hover | `transform: translateY(-1px)` or `scale(1.02)` "rise" | G4 | `box-shadow: inset 0 0 0 1px var(--border-emphasis)` only |
| `AgentTreeView.vue` (entire file) | A third divergent visualisation of the same data | CC-9 | Deprecated. Sub-agent parent/child relationships are encoded by swimlane indentation + the inspector. Delete after one release with a redirect from `?view=agent-tree` to swimlane. |
| Per-view ruler implementations | Each sub-view computes its own ticks | CC-9 | One `<TimelineRuler>` primitive (§14.4); both views consume it |
| Inline `font-size: 0.6875rem` etc. on the info bar | One-off pixel sizes | MASTER §3.3 | Use `text.small` / `text.mono` from the type scale |
| `text-transform: uppercase` on `pill-label` (`SessionTimelineView.vue:113`) | `text.micro` discipline | G7 | The info bar's labels are not pills — use `text.small` weight 500, mixed-case, `--text-tertiary` |

---

## 14.10 · Acceptance checklist

### Chrome & primitives
- [ ] No `<h1>` or page subtitle rendered inside `SessionTimelineView.vue`
- [ ] View toggle is `<SegmentedControl>` from `@tracepilot/ui`; `BtnGroup` is removed from this view
- [ ] Single `<ToolbarRow :sticky>` band; no inline ad-hoc toolbar markup
- [ ] `<TimelineRuler>` and `<SpanBar>` are exported from `@tracepilot/ui` and used by **both** swimlane and waterfall views (`tracepilot/no-local-reimplementation` extended with `.ruler-track`, `.ruler-tick`, `.span-bar`)
- [ ] `AgentTreeView.vue` deleted; redirect from legacy `?view=agent-tree` URL to swimlane

### Tokens & visual hygiene
- [ ] `rg "#161b22|#30363d" apps/desktop/src` returns zero hits (G6 / CC-11)
- [ ] No hex literal in `apps/desktop/src/views/SessionTimelineView.vue` or in `apps/desktop/src/components/timeline/**/*.vue`
- [ ] No `linear-gradient` in any timeline component CSS (G3)
- [ ] No `backdrop-filter` in any timeline component CSS (G2)
- [ ] No `transform: scale|translateY` inside `:hover` blocks (G4)
- [ ] No emoji in templates, in `iconName` props, or in data files imported by this view (G1; specifically removes the `📊` and `💬` literals)
- [ ] Lane hue comes from `--agent-color-main…task` plus `--chart-info` / `--chart-lime` for overflow — no other categorical tokens

### Interaction & state
- [ ] All shortcuts in §14.5 register via `useShortcut` and appear in the `?` overlay's *Active View* group
- [ ] View choice persists per session id under `tracepilot:timeline:view:<sessionId>`
- [ ] Ruler scale persists globally under `tracepilot:timeline:scale`
- [ ] Selection survives `s` ↔ `w` view toggle and scrolls into view in the new rendering
- [ ] Sub-pixel spans clamp to 1px and stack into a `+N` cluster with keyboard-reachable inspector
- [ ] Live sessions show a pulsing leading edge that respects `prefers-reduced-motion`
- [ ] `Esc` unwinds in this order: pinned span → selection → focus toolbar

### Motion
- [ ] All transitions are 120 / 180 / 220 ms; only `transform` and `opacity` are animated
- [ ] No `animation: … infinite` outside the live-stream pulse, which is wrapped in `@media (prefers-reduced-motion: no-preference)`

### Accessibility
- [ ] Canvas root has `role="region" aria-label aria-describedby` pointing at the visually-hidden `<TimelineSummary>` `<dl>`
- [ ] Top-N longest spans, outcome distribution, and turn / span counts are present in the summary and update via `aria-live="polite"`
- [ ] Every span carries an outcome Lucide icon **and** the outcome word in its `aria-label` — no colour-only encoding
- [ ] Ruler ticks are `aria-hidden="true"`; the scale toggle uses `aria-pressed`
- [ ] Keyboard navigation reaches every span via `j` / `k`; lane changes are announced via `useAnnouncer`
- [ ] Focus ring is the global 2px `--accent-emphasis` / 2px-offset ring; never removed

### Audit lines closed
- [ ] UI-AUDIT lines 83–89 (Session Timeline view): emoji removed, hex literals removed, three views consolidated to two with shared primitives, swimlane-first layout adopted with promoted waterfall-on-click, span inspector renders in a right-side dock
- [ ] UI-AUDIT lines 329–333 (Timeline Sub-Views): one `<TimelineRuler>`, one `<SpanBar>`, one default view (swimlane), Agent Tree deprecated
