# Desktop virtualization audit

Audit follow-up for `w5-3` from the outstanding follow-up implementation plan.

This document is the **audit only**. Per the usability watchlist, the default
posture is **NOT to virtualize** unless we can measure a concrete UX win at
worst-case row counts; virtualization tends to hurt scroll feel, accessibility,
and find-in-page. No code in `apps/desktop` is changed by the audit pass.

> **Note on dependencies.** The original `w5-3` write-up described
> `vue-virtual-scroller` as "already a dep". As of this audit it is **not**
> installed (no match in `pnpm-lock.yaml`, no `RecycleScroller` / `DynamicScroller`
> imports anywhere under `apps/desktop`). Adopting virtualization would require
> adding the dependency (or hand-rolling a windowed renderer).

## Scope

Scanned `apps/desktop/src/**/*.vue` for `v-for` over data sources that can grow
unbounded with session activity (sessions, turns, tool calls, files, search
results, events, todos, orchestration feed). Each candidate is sized against
its store/composable, current rendering strategy is summarised, and a
recommendation is made.

## Candidates

### 1. SessionListView — sessions grid
- **File:line.** `apps/desktop/src/views/SessionListView.vue:217`
- **Source.** `useSessionsStore().filteredSessions` (computed over
  `sessions.ts:filteredSessions`, derived from `store.sessions`).
- **Row count.** Typical: a few dozen. Worst-case observed for power users:
  several hundred indexed sessions; the store imposes no upper bound and
  `SessionCard` is not lazy.
- **Current rendering.** Eager render of every card in a CSS grid. There is no
  pagination, no `v-show`-based windowing, no `IntersectionObserver`. Each
  `SessionCard` renders metadata, badges, and a mini-timeline.
- **Recommendation.** **Paginate or chunked-render.** Virtualization is awkward
  for a responsive CSS grid (variable column count). A simpler win is a "load
  more" cap or `IntersectionObserver`-driven incremental rendering. Defer
  virtualization until we measure a real freeze on a >500-session library.
- **Effort.** S (cap + "load more"), M (true windowed grid).
- **Bug or opportunity.** Opportunity. No correctness issue — just risk of jank
  on large libraries.

### 2. ConversationTurnList — full session conversation
- **File:line.** `apps/desktop/src/components/conversation/ConversationTurnList.vue:124`
  (compact mode), `:222` (timeline mode).
- **Source.** `turns: ConversationTurn[]` prop, fed by
  `useSessionDetailStore().turns` for the active session.
- **Row count.** Typical: 10–50 turns. Worst-case observed: 335+ turns (called
  out explicitly in `docs/design/timeline-redesign.md`). Each turn renders
  multiple nested `v-for`s (sections × tool calls × messages × session events),
  so DOM cost compounds.
- **Current rendering.** Eager. Every turn is materialised on mount; sections
  per turn are computed via `useConversationSections`.
- **Recommendation.** **Strongest candidate for virtualization in the app**, but
  variable per-turn height (markdown, expandable tool calls, reasoning blocks)
  makes naive `RecycleScroller` a poor fit; a `DynamicScroller`-style
  measure-then-render approach would be required. Watch-listed: leave as-is
  until we have a forced 500-turn perf repro. If something needs to ship
  sooner, a "virtualize past N turns" cap (e.g. only mount the most recent 100
  turns + a "Load earlier" button) is far less risky than full virtualization.
- **Effort.** L (true `DynamicScroller`), S (windowed cap with "Load earlier").
- **Bug or opportunity.** Opportunity.

### 3. ReplayTimelinePane — replay step list
- **File:line.** `apps/desktop/src/components/replay/ReplayTimelinePane.vue:51`
- **Source.** `visibleSteps` prop, computed in
  `views/SessionReplayView.vue:108` as
  `replaySteps.filter((s) => s.index <= current + MAX_FUTURE_SKELETONS)` with
  `MAX_FUTURE_SKELETONS = 5`.
- **Row count.** Bounded by `currentStep + 5`. Worst-case ≈ replay length, but
  only steps up to `currentStep` are fully materialised; future steps render a
  lightweight skeleton.
- **Current rendering.** Already chunked-render: future steps capped at +5,
  active step `scrollIntoView` on change.
- **Recommendation.** **Leave.** The chunked-render strategy is sound. If
  long-running replays still feel sluggish past ~500 past steps, consider
  collapsing past steps into an accordion before adding virtualization.
- **Effort.** N/A.
- **Bug or opportunity.** Neither — already mitigated.

### 4. SessionSearchView — flat search results
- **File:line.** `apps/desktop/src/views/SessionSearchView.vue:202`
- **Source.** `useSessionSearchStore().results`. Pagination owned by
  `stores/search/query.ts` (`pageSize = 50`, `hasMore` flag, server-side
  paging via `executor.ts`).
- **Row count.** Bounded by `pageSize` (50 per page). Total dataset can be
  millions of indexed events but only one page is in DOM at a time.
- **Current rendering.** Server-paged; `SessionSearchPagination` controls page.
- **Recommendation.** **Leave.** Pagination already in place.
- **Effort.** N/A.
- **Bug or opportunity.** Neither.

### 5. SearchGroupedResults — grouped search results
- **File:line.** `apps/desktop/src/components/search/SearchGroupedResults.vue:28, 67`
- **Source.** `groupedResults` prop, derived from `store.results` (the same
  paged dataset).
- **Row count.** Bounded by the page (50 results) split across N session
  groups. Each group has collapse/expand state.
- **Current rendering.** Eager within a page; collapse state lets users hide
  full groups.
- **Recommendation.** **Leave.** Collapse + pagination are sufficient.
- **Effort.** N/A.
- **Bug or opportunity.** Neither.

### 6. EventsTab — session events table
- **File:line.** `apps/desktop/src/views/tabs/EventsTab.vue` (table around `:151`)
- **Source.** `useSessionDetailStore().events.events`, paged with `pageSize = 50`.
- **Row count.** Bounded by page size.
- **Current rendering.** Server-paged with explicit pager UI.
- **Recommendation.** **Leave.**
- **Effort.** N/A.
- **Bug or opportunity.** Neither.

### 7. OrchestrationActivityFeed
- **File:line.** `apps/desktop/src/views/orchestration/home/OrchestrationActivityFeed.vue:71`
- **Source.** `useOrchestrationStore().activityFeed` (or `mockFeed` fallback).
- **Row count.** Typical: small (<50). Worst-case: grows monotonically while
  the orchestrator runs; no cap is enforced in the store today.
- **Current rendering.** Eager render of the entire feed; no max length, no
  windowing.
- **Recommendation.** **Cap in the store.** Add a sliding-window cap (e.g.
  retain the most recent 200 events, drop older ones) in
  `stores/orchestration` rather than virtualizing the view. This addresses
  both DOM size and unbounded memory growth. Virtualization is overkill for an
  activity feed.
- **Effort.** S.
- **Bug or opportunity.** **Latent bug** (unbounded growth) — worth tracking
  separately from this audit.

### 8. MetricsCodeChanges — files-modified table
- **File:line.** `apps/desktop/src/components/metrics/MetricsCodeChanges.vue:25`
- **Source.** `metrics.codeChanges.filesModified` (per-session).
- **Row count.** Typical: 5–50 files. Worst-case: a refactor session can touch
  hundreds of files.
- **Current rendering.** Eager `<tr v-for>` table.
- **Recommendation.** **Chunked-render with "Show all"** — render the first 50
  rows and surface a "Show all N files" toggle. Same pattern as
  `ReplayStepContent`'s `MAX_VISIBLE_TOOLS`. Avoids virtualization complexity.
- **Effort.** S.
- **Bug or opportunity.** Opportunity.

### 9. ReplaySidebar — files-modified for the current step
- **File:line.** `apps/desktop/src/components/replay/ReplaySidebar.vue:120`
- **Source.** `step.filesModified` for a single step (extracted in
  `replayTransform.ts`).
- **Row count.** Typically 1–10 per step.
- **Current rendering.** Eager `<li v-for>`.
- **Recommendation.** **Leave.** Per-step rather than per-session, naturally
  small.
- **Effort.** N/A.
- **Bug or opportunity.** Neither.

### 10. ReplayEventTicker
- **File:line.** `apps/desktop/src/components/replay/ReplayEventTicker.vue:82, 92`
- **Source.** Computed from session events visited up to `currentStep`.
- **Row count.** Bounded by step count, typically <100 events.
- **Current rendering.** Eager. Note: `tickerEvents` is iterated **twice** in
  the same template (once for the dot row, once for the labels) — both render
  the same array. This is intentional (parallel layered layout) but doubles
  DOM cost.
- **Recommendation.** **Leave.** Sizes are small. If a session ever produces
  >500 ticker events the design should be re-thought (clustering rather than
  virtualization).
- **Effort.** N/A.
- **Bug or opportunity.** Minor opportunity (the duplicate iteration is worth
  documenting if anyone rewrites the ticker).

### 11. TodosTab
- **File:line.** `apps/desktop/src/views/tabs/TodosTab.vue:164`
- **Source.** Per-session todos. Typical: <50.
- **Current rendering.** Eager.
- **Recommendation.** **Leave.**
- **Bug or opportunity.** Neither.

### 12. SkillAssetsTree — file browser tree
- **File:line.** `apps/desktop/src/components/skills/SkillAssetsTree.vue:97`
- **Source.** `useFileBrowserTree(...).visibleRows` — already collapses
  unexpanded folders.
- **Row count.** Bounded by user expansion state. Can be large for deeply
  expanded skills.
- **Current rendering.** Eager render of `visibleRows`. Folders collapse
  children server-side in the composable, so realistic counts stay moderate.
- **Recommendation.** **Leave** unless someone reports lag on a giant skill
  asset tree.
- **Bug or opportunity.** Neither.

### 13. ToolAnalysisView — sortedTools tables
- **File:line.** `apps/desktop/src/views/ToolAnalysisView.vue:189, 292`
- **Source.** Distinct tool names observed across selected sessions. Bounded by
  the number of registered tools (~20–40).
- **Recommendation.** **Leave.**
- **Bug or opportunity.** Neither.

### 14. SearchPaletteResults / SearchBrowsePresets / SearchFilterSidebar lists
- All are bounded by paged search state, recent-searches cap, or
  registered-tool count. **Leave.**

## Prioritised summary

| Rank | List | File | Worst-case rows | Recommendation | Effort | Notes |
|----:|------|------|----------------:|----------------|:------:|-------|
| 1 | OrchestrationActivityFeed | `views/orchestration/home/OrchestrationActivityFeed.vue` | unbounded | **Cap in store** (latent bug) | S | Track as separate fix |
| 2 | SessionListView grid | `views/SessionListView.vue` | low thousands | Paginate / "Load more" | S–M | Avoid grid virtualization |
| 3 | ConversationTurnList | `components/conversation/ConversationTurnList.vue` | 335+ (observed) | Windowed cap, then `DynamicScroller` if needed | S → L | Highest virtualization payoff but highest UX risk |
| 4 | MetricsCodeChanges files table | `components/metrics/MetricsCodeChanges.vue` | low hundreds | Chunked-render with "Show all" | S | Mirrors existing tool-cap pattern |
| 5 | ReplayEventTicker (duplicate iteration) | `components/replay/ReplayEventTicker.vue` | low hundreds | Document; revisit if >500 events | — | Minor |
| — | All other lists audited | — | bounded | **Leave** | — | Pagination, caps, or naturally small |

## Conclusion

Of fourteen `v-for`s reviewed across `apps/desktop/src`, **only one is a latent
bug** (`OrchestrationActivityFeed` retains events without bound), and **two**
(`SessionListView`, `ConversationTurnList`) are realistic candidates where a
power-user dataset could degrade scroll performance. None warrant introducing a
virtualization library in this branch; the cheapest and lowest-risk wins are
sliding-window caps in stores and "Show all" chunked rendering — both
consistent with patterns already in the codebase
(`ReplayStepContent.MAX_VISIBLE_TOOLS`, `EventsTab` pagination,
`SessionSearchView` server paging).
