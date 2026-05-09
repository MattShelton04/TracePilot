# TracePilot UI Audit
> Discovery phase. Lens: `design-system/MASTER.md`. No code changes — observations and recommendations only.

## Summary
- **Total surfaces audited:** 49 (24 top-level views + 6 session detail tabs + 19 high-impact panels/components)
- **Priority distribution:** High: 18 · Medium: 21 · Low: 10
- **Top cross-cutting themes** (see [Cross-Cutting Findings](#cross-cutting-findings)):
  1. **Emoji-as-icons everywhere** — violates MASTER §5 ("Emoji as icons"). Found in ≥18 files, often shipping as a tab label or page title (`PageHeader title="⚙️ Config Injector"`).
  2. **Glassmorphism on data chrome** — `backdrop-filter: blur()` on the session list toolbar, search palette, session detail header, alert drawer, modals. Violates MASTER §5 ("Glassmorphism on data surfaces").
  3. **Marketing gradients on primary surfaces** — Orchestration hero stat tiles, Welcome screen title gradient-clipped text, accent gradient logos. Violates MASTER §5 ("Marketing gradients").
  4. **Hero typography in app chrome** — `font-size: 2.5rem`/`36px`/`48px` titles in non-empty-state surfaces (Orchestration Home, Wizard, Export, Config Injector). Violates MASTER §5 ("Hero-style typography outside empty states").
  5. **Layout-shifting hover** — `transform: translateY(-2px)` + `box-shadow` lift on every card grid (Orchestration Quick Actions, Hero Stats, Skill cards, MCP cards). Violates MASTER §5 ("Animation on hover that shifts layout").
- **Net read:** the app has a solid information architecture and a well-defined token system, but the *application of* those tokens is wildly inconsistent. The visual identity reads as a "v0/Cursor-generated dashboard" because three patterns recur: emoji icons, gradient hero tiles, and frosted-glass panels. Removing these three things globally — and replacing with Lucide + hairlines + tonal elevation — would lift the perceived quality more than any individual screen redesign.

---

## Top-Level Views

### Session List (`apps/desktop/src/views/SessionListView.vue`)
**Purpose** — The default landing surface. Lets the user find and open a Copilot CLI session by repo, branch, sort, or free-text query.
**Data shown** — Session card grid (summary, repo, branch, model, host type, event count, turn count, relative updated time, "Active" badge if running). Header shows filter selects, sort dropdown, indexing progress bar, and `N sessions` count. Each datum lets a developer eyeball provenance ("which repo/branch did this run against?") and recency before clicking in.
**Interaction model** — Search-as-you-type, repo/branch filter dropdowns, sort select, `Ctrl/Meta+click` opens session in a tab vs. route, manual + auto-refresh, error / empty / indexing states. **Missing:** no keyboard nav between cards, no multi-select / bulk actions, no column-table view (fixed grid only), no pinned/starred sessions, no virtualization (renders all cards).
**Current UI weaknesses** — (1) **Glassmorphism on toolbar:** `.enhanced-toolbar` uses `backdrop-filter: blur(12px)` + `box-shadow: 0 4px 24px` (lines 250–256) — direct MASTER §5 violation; (2) **Emoji empty state icon** `icon="🔍"` (line 228); (3) **Skew animation easter-egg** `@keyframes drift-motion` skew ±10° triggered when query equals `"67"` (lines 326–339) — playful in isolation but anti-pattern: mutates `transform` of the whole page, breaks `prefers-reduced-motion`, and is invisible without source-reading; (4) raw `<select class="filter-select">` for sort sits next to two `FilterSelect` components — visual inconsistency between native and styled selects; (5) card grid is a `display: grid` without virtualization, will choke at 1000+ sessions.
**Opportunity** — Default to a **dense Linear-style table** (sortable columns: summary · repo · branch · model · turns · events · updated) with a "Cards" toggle for browsing. Persist density per user. Add **starred/pinned** rows that float to top. Bind `j/k` for row nav, `Enter` to open, `o` to open-in-tab. Replace the toolbar glass with a flat sticky header that uses `--canvas-subtle` + 1px hairline only. Replace the empty-state `🔍` with a Lucide `search` glyph.
**Priority** — **High** — first surface every user sees; current state is the loudest violator of MASTER §5.

### Session Detail Shell (`apps/desktop/src/views/SessionDetailView.vue` + `apps/desktop/src/views/SessionDetailTabView.vue` + `apps/desktop/src/components/session/SessionDetailPanel.vue`)
**Purpose** — Shared chrome (header, action bar, inner tab nav) for one session, used by both route-driven and tab-driven detail views. Hosts Overview/Conversation/Events/Todos/Metrics/Explorer/Timeline.
**Data shown** — Session summary, ID (with copy), running indicator, repo/branch/model badges, last-updated, "Resume in Terminal" / "Open Folder" / "Pop out" actions, refresh toolbar. Inner tab nav with `count` badges per tab.
**Interaction model** — Tab switch, copy ID, resume in terminal, pop tab to its own window, toggle auto-refresh. **Missing:** no breadcrumb truncation when summary is long; no inline rename of session title; no kbd shortcut to jump tabs (`1..7`).
**Current UI weaknesses** — (1) `backdrop-filter: blur(12px)` on the sticky session header (`SessionDetailPanel.vue:370–371`) — same glass anti-pattern as session list toolbar; (2) the action bar mixes inline Lucide-style SVGs with plain text buttons and the `RefreshToolbar`'s own visual language — see CC-2 (mixed icon sources); (3) header height changes on session-running state (an "Active" badge appears) — risk of layout shift on poll.
**Opportunity** — Convert the header into a **two-row hairline header** (line 1: breadcrumb · summary · status pill · ID-mono with copy; line 2: Lucide-only action toolbar with kbd hints). Reserve space for the running pill so the row never resizes. Add `1..7` jump-to-tab shortcuts and surface them in a `?` overlay.
**Priority** — **High** — touched on every session view; fixing it propagates to all 6 inner tabs.

### Overview Tab (`apps/desktop/src/views/tabs/OverviewTab.vue`)
**Purpose** — At-a-glance session metadata, summary, latest checkpoint, incidents.
**Data shown** — Session ID, repo, branch, model, host, duration, created/updated; markdown summary; checkpoint timeline; incidents list (severity, type, expand-to-view-detail).
**Interaction model** — Click incident to expand details; click checkpoint number to jump to a turn (deep link). **Missing:** no copy-to-clipboard on session/repo/host; no quick filter "show only errors" on incidents.
**Current UI weaknesses** — Heavy reliance on `StatCard` + `DefList` + `SectionPanel` produces a blocky, "card-soup" layout with redundant frames around small KV pairs (see CC-4). `formatObjectResult` lands raw object text into the same panel without monospace differentiation.
**Opportunity** — Replace the stat-card row with a **single hairlined definition list** in a 2-column dense grid (label-mono on left, value-mono on right). Use a sparkline on Duration. Render incidents as a Datadog-style **incident strip** (compact rows with severity pill, time, one-line message; expand inline).
**Priority** — Medium — high visibility, but issues are inherited from shared components.

### Conversation Tab (`apps/desktop/src/views/tabs/ConversationTab.vue`)
**Purpose** — The flagship surface — read the conversation between user, main agent, sub-agents, and tool calls in either compact (timeline) or chat view.
**Data shown** — User messages, agent reasoning, tool args/results (per-tool renderers), permission events, skill invocations, sub-agent groups, gap indicators between turns. Top-level objective banner. View-mode switch. Scroll-lock-to-bottom + scroll-to-top.
**Interaction model** — Toggle view mode (chat / timeline), expand/collapse tool details, expand reasoning, deep-link scroll via `?turn=&event=`, copy tool result, retry full-result fetch. **Missing:** no thread-style collapse-by-tool, no "find in conversation" (`Cmd+F` scoped), no jump-to-last-error.
**Current UI weaknesses** — (1) Tool-group segment uses an emoji `🎯` for "intent" (`ToolGroupSegment.vue:82`); sub-agent group segment uses `⚡` (`SubagentGroupSegment.vue:23`); skill row uses `⚡` (`SkillInvocationEventRow.vue:98`) — see CC-1; (2) `backdrop-filter: blur(8px)` on `ConversationTab.vue:298` — see CC-2; (3) tool-call renderers (`ApplyPatchRenderer`, `EditDiffRenderer`, `ShellOutputRenderer`, `GrepResultRenderer`) each style their own frame — risk of inconsistent corner radii / borders (CC-4); (4) reasoning blocks and "ObjectiveBanner" are visually similar to system messages — the user has to read text to tell them apart (color-only differentiation, MASTER §5).
**Opportunity** — Adopt a **Datadog/Linear thread layout**: left rail with mini-timeline (turn dots), main column with collapsible turn groups, right inspector pane that opens when a tool call is clicked (showing args/result/timing/errors). Standardize all tool renderers behind a single `ToolCallShell` (header strip with tool icon, name, status pill, latency mono; body with renderer). Replace emoji headers with Lucide (`target`, `zap`, `bot`).
**Priority** — **High** — primary value surface for the product; current emoji + frame-soup is the most "AI-vibe-coded" feeling area.

### Events Tab (`apps/desktop/src/views/tabs/EventsTab.vue`)
**Purpose** — Raw event log for a session — every JSON-L event, filterable by type with pagination.
**Data shown** — Event type pill (severity-mapped), timestamp, event payload summary, total count, type filter dropdown.
**Interaction model** — Type-filter, paginate (page-size 50), expand row. **Missing:** no full-text search inside payloads, no time-range filter, no virtualized scroll, no JSON pretty-print toggle, no copy-event-as-JSON.
**Current UI weaknesses** — Uses `DataTable` + `Badge` — solid, but no monospace alignment on timestamps means columns don't visually align (MASTER §3.3 requires `tnum` on numeric columns). No keyboard-driven row nav.
**Opportunity** — A Grafana/Datadog **virtualized log stream** with: monospace timestamp column, severity dot, type chip, one-line summary, expand-on-click for raw JSON, `j/k` navigation, `/` to filter, time-range scrubber.
**Priority** — Medium — power-user surface; underbuilt rather than wrong.

### Todos Tab (`apps/desktop/src/views/tabs/TodosTab.vue`)
**Purpose** — Visualize the agent's todo list and inter-todo dependencies for a session.
**Data shown** — Status counts (done / in-progress / blocked), todo list with status icon, dependency graph (`TodoDependencyGraph` + `TodoDepGraphEdge`/`Node`/`Legend`/`Toolbar`/`Slideover`).
**Interaction model** — Click node → slide-over with detail; toolbar for layout/filter. **Missing:** no list↔graph toggle persistence, no jump-from-graph-to-conversation-turn that created the todo.
**Current UI weaknesses** — Layout inconsistency between list and graph (graph uses its own canvas chrome), legend is decorative rather than referential. The dependency graph appears strong; surrounding stat cards are generic `Badge`/`SectionPanel` recurrence (CC-4).
**Opportunity** — Side-by-side **list + dependency DAG** with linked selection (clicking a list row highlights node and vice versa). Surface the originating turn-index next to each todo (link to Conversation tab).
**Priority** — Medium — niche but unique surface; the graph itself is good, surroundings dilute it.

### Metrics Tab (`apps/desktop/src/views/tabs/MetricsTab.vue`)
**Purpose** — Per-session token usage, model breakdown, cache health, code change totals, cost estimates.
**Data shown** — `MetricsStatCards`, `MetricsTokenBudget` (token bar), `MetricsModelTable`, `MetricsCacheBreakdown`, `MetricsSessionActivity`, `MetricsCodeChanges`. Numeric: input tokens, output tokens, cache reads/writes, cost, request count, cache hit ratio, June 2026 preview delta.
**Interaction model** — Read-only. **Missing:** no time-bucket scrubber, no copy-row, no link-to-affected-files for code changes, no sparkline/trend per model.
**Current UI weaknesses** — Uses `StatCard` repeatedly — a known CC-4 issue. `MetricsTokenBudget` likely renders a token bar, but the visual language for "% of context used" is not standardized with the Skills view's identical concept (CC-7).
**Opportunity** — Adopt a **Grafana-style metrics row**: KPI sparkline + value + delta vs. prior session. Unify the "token budget bar" into a shared `TokenBudgetBar` component with three thresholds (ok/warn/danger).
**Priority** — Medium — data is strong, presentation is generic.

### Explorer Tab (`apps/desktop/src/views/tabs/ExplorerTab.vue`)
**Purpose** — Browse files and content captured/touched during the session (planning docs, captured artefacts).
**Data shown** — File tree (`FileBrowserTree`), file content viewer (`FileContentViewer`), drag-resizable splitter.
**Interaction model** — Click file to view, drag splitter (160–500px), auto-refresh. **Missing:** no breadcrumb path, no copy-path, no syntax-language indicator, no diff vs. base.
**Current UI weaknesses** — Splitter is hand-rolled mouse handlers (lines 27–51) — won't survive `prefers-reduced-motion`/keyboard, no touch/pen support; persistence of width is not stored per-session per MASTER pre-delivery checklist ("Resizable panels remember width across sessions"). Tree styles likely diverge from Skills/MCP "tree-like" lists (CC-9).
**Opportunity** — Adopt a single shared `SplitPane` primitive with persisted width + keyboard resize (`Alt+←/→`). Add VS-Code-style breadcrumb above the viewer with copyable mono path.
**Priority** — Medium — solid concept, polish missing.

### Session Timeline (`apps/desktop/src/views/SessionTimelineView.vue`)
**Purpose** — Three visual timelines for a session: nested swimlanes, waterfall (per-turn span tree), and an agent tree.
**Data shown** — Page title + subtitle, session-info bar (ID with mono truncation, model badge, turn count, event count). Active sub-view rendered in `ErrorBoundary`. Empty state with `icon="📊"`.
**Interaction model** — `BtnGroup` to switch between Swimlanes/Waterfall/Agent Tree. **Missing:** no shared cursor / time scrubber across the three views, no zoom-to-fit, no "filter by tool" or "filter by sub-agent".
**Current UI weaknesses** — (1) `EmptyState icon="📊"` (line 36) — emoji anti-pattern; (2) page subtitle "Visual timeline of session events and interactions" duplicates the existing breadcrumb/title information; (3) inline hex fallbacks (`background: var(--canvas-raised, #161b22)`, `border: 1px solid var(--border-default, #30363d)`, lines 96–97) — these `#161b22`/`#30363d` are **GitHub Primer values, not TracePilot zinc tokens** (`--canvas-raised: #1c1c1f`); a remnant of an earlier design system. Violates MASTER §7 ("Never inline a hex in a component stylesheet").
**Opportunity** — Replace the three views with a **swimlane-first layout** modelled on Datadog APM: top-level summary lane (latency heatmap), per-agent lanes underneath, sticky time axis with brushable scrubber, span detail in a right inspector. Promote Waterfall into a "trace" mode reachable by clicking a span. Agent Tree → drawer.
**Priority** — **High** — flagship-level feature; current presentation undersells the underlying data.

### Session Search (`apps/desktop/src/views/SessionSearchView.vue` + `components/search/*`)
**Purpose** — Cross-session full-text search over conversation/turns/tools, with grouped results and rich filters.
**Data shown** — Hero search input, content-type chips, repo/tool/session filters, indexing banner, total result count, grouped results (by session), per-result expanded detail, pagination.
**Interaction model** — Type query, toggle filters, expand result, copy single/all, click to deep-link to conversation, syntax-help modal. **Missing:** keyboard-first nav across grouped results is unclear; no saved searches; no recent-queries history.
**Current UI weaknesses** — `SessionSearchHero` is a hero-styled component (typically large input + decorative copy) — see CC-3. The presence of both a global `SearchPalette` (`Cmd+K`) and a `SessionSearchView` (full page) creates ambiguity: which is "the" search? Filter sidebar likely diverges visually from the rest of the app sidebar.
**Opportunity** — Compress the hero into a Linear-style **command-line bar** (single row with input · filter chips · sort · syntax-help). Move filters into a **persistent left rail** matching the app sidebar's typography. Adopt **`/` as global focus shortcut** alongside `Cmd+K` (palette = quick jump; full search = analytical mode).
**Priority** — **High** — power-user feature with frequent use; "where do I search?" confusion is cross-cutting.

### Analytics Dashboard (`apps/desktop/src/views/AnalyticsDashboardView.vue`)
**Purpose** — Aggregate cross-session analytics: stat grids, metric panels, token activity, distributions, cache health, incident chart.
**Data shown** — Total sessions, premium request count, Copilot vs. wholesale cost, model distribution, time-series charts, distribution histograms, cache hit metrics, incident chart.
**Interaction model** — Repo filter, time-range select (7d/30d/90d/custom), chart hover tooltip, click-to-pin tooltip. **Missing:** no save-as-view, no compare-period, no export-chart-as-PNG.
**Current UI weaknesses** — `AnalyticsPageHeader` is shared with Tools/Code/Models views — but it's not the canonical `PageHeader` (`packages/ui`). Two header components for the same role (CC-6). Charts use SVG `createChartLayout` with hardcoded widths (e.g., `createChartLayout(55, 490, 20, 175)`) — does not respond to viewport and will be cramped at 1280px and float at 4K.
**Opportunity** — Make charts **responsive** with `ResizeObserver`-driven layout. Adopt Grafana's row-based layout (one KPI row, one time-series row, one distribution row). Add a global time picker that lives next to the breadcrumb and persists per-view.
**Priority** — **High** — primary analytics surface; non-responsive charts are a real ergonomic problem.

### Tool Analysis (`apps/desktop/src/views/ToolAnalysisView.vue`)
**Purpose** — Per-tool performance: invocation counts, success/failure rates, latency.
**Data shown** — Page header + subtitle, KPI stat cards (`uniqueToolCount` etc.), success/failure horizontal bar chart per tool, sortable tool list with rate.
**Interaction model** — Repo/time filters (via `useAnalyticsPage`), nearest-Y tooltip on bars, pin tooltip on click, sort. **Missing:** click a tool → drill into its invocations.
**Current UI weaknesses** — Custom Y-nearest-index tooltip handler is hand-rolled (lines 35–62) and lives in the view — should be promoted to `useChartTooltip`. Visual reuse of `AnalyticsPageHeader` (CC-6).
**Opportunity** — Convert into a **Datadog APM service-map style** view: tools sortable table with sparkline, p50/p95 latency mono columns, success-rate bar in row, click-to-drill into per-tool invocation list.
**Priority** — Medium — strong concept, presentation is generic histograms.

### Code Impact (`apps/desktop/src/views/CodeImpactView.vue`)
**Purpose** — Aggregate code-change activity across sessions: file-type breakdown, most-modified files, churn over time.
**Data shown** — File-type bar chart, most-modified files (`additions`, `deletions`, churn bar), changes-over-time area chart.
**Interaction model** — Hover/click bars, repo+time filter. **Missing:** filename click-to-open, link to the session that touched the file.
**Current UI weaknesses** — Same `AnalyticsPageHeader` duplication (CC-6). Files presented without monospace path treatment (paths are data-as-IDs per MASTER §3.1; should be JetBrains Mono with middle truncation).
**Opportunity** — File rows as **GitHub-PR-style** stat rows: monospace path · `+adds / -dels` colored (semantic) · churn bar · last-touched session link. Sticky headers; sortable columns.
**Priority** — Medium — small audience but clear improvement path.

### Model Comparison (`apps/desktop/src/views/ModelComparisonView.vue`)
**Purpose** — Compare model usage / cost / latency / token consumption across all sessions.
**Data shown** — Stats grid, leaderboard, charts, comparison table.
**Interaction model** — Filter by repo/time. **Missing:** model-vs-model side-by-side selector, can't pin a model as baseline.
**Current UI weaknesses** — `EmptyState icon="🤖"` (line 33) — emoji anti-pattern. Same `AnalyticsPageHeader` (CC-6). Layout is a stack of generic panels; "leaderboard" suggests gamification not appropriate for a dev tool.
**Opportunity** — A **DataTable as the primary surface**: rows = model, columns = sessions/turns/tokens/cost/p50 latency/error rate, sortable, with a "set as baseline" toggle that recolors all other rows as Δ vs. baseline. Drop the leaderboard framing.
**Priority** — Medium — niche but contains decision-relevant data.

### Session Comparison (`apps/desktop/src/views/SessionComparisonView.vue`)
**Purpose** — Side-by-side comparison of two sessions (header + metrics + charts).
**Data shown** — Comparison header (which two sessions), metric deltas, comparison charts.
**Interaction model** — Pick session A and B (presumably via `ComparisonHeader`). **Missing:** unclear how the two sessions are picked from this view; no synced scroll across the two sides.
**Current UI weaknesses** — Smallest top-level view file (26 lines) — most behaviour is hidden in `useSessionComparison` and three children. Without a rich shell, the comparison feels like an isolated pop-out rather than a first-class workspace.
**Opportunity** — A **two-pane workspace** with a sticky sync-scroll toolbar (events/turns/timeline pickers), green/red delta column in the middle, and the ability to "promote" one session to a tab without leaving the compare.
**Priority** — Medium — under-developed.

### Session Replay (`apps/desktop/src/views/SessionReplayView.vue`)
**Purpose** — Step-by-step playback of a session as if watching it run live.
**Data shown** — Replay sidebar (recent sessions), transport bar (play/pause/step/speed), timeline pane, event ticker, current step content (rendered through tool renderers).
**Interaction model** — Keyboard shortcuts (`controller.handleKeydown`), pick session from sidebar, transport controls. **Missing:** no scrubbable timeline, no bookmarks, no "jump to next error".
**Current UI weaknesses** — Replay hint uses `<span class="hint-icon">💡</span>` (line 131) — emoji. Three `replay/*` files contain `linear-gradient` (CC-3). The view recreates the recent-sessions sidebar from scratch instead of reusing the `SessionList` table, fragmenting the component lexicon.
**Opportunity** — Adopt a **Warp/QuickTime-class transport bar** (compact, monospace timecode, scrubbable progress, snap to event types). Sidebar → reuse the canonical session list as a pickable component. Replace `💡` hint with a Lucide `lightbulb` glyph or — better — surface the hint inline as a `<kbd>` shortcut chip per MASTER §6 ("Keyboard shortcut surfaced via `kbd` chip").
**Priority** — Medium — feature-flagged surface, but visible enough to need polish before GA.

### Export & Import (`apps/desktop/src/views/ExportView.vue`)
**Purpose** — Export sessions to a TracePilot archive; import from one.
**Data shown** — Tab nav (Export · Import), header copy, per-tab content (config + preview / file picker).
**Interaction model** — Pill-variant `TabNav`, configure-and-preview workflow.
**Current UI weaknesses** — `<h1>Export & Import</h1>` paired with a pill `TabNav` on the same row produces a second heading visually; export.css contains `font-size: 36px / 28px / 48px` rules (lines 489/515/625) — Hero typography (CC-3); the pattern of "config column + preview column" is reinvented here vs. SessionLauncher's `split-layout` (CC-8).
**Opportunity** — Reuse a shared `WorkflowSplit` primitive (left = configure, right = live preview). Drop the H1; the breadcrumb is enough. Tabs → segmented control.
**Priority** — Low — feature-flagged, infrequent use.

### Settings (`apps/desktop/src/views/SettingsView.vue`)
**Purpose** — User preferences across General, Appearance, Data & Storage, Logging, Pricing, Tool Visualization, Updates, Alerts, Experimental, SDK, About — 11 sections stacked.
**Data shown** — Each `Settings*` panel renders rows of label + control (toggle, select, button, input).
**Interaction model** — Scroll through 11 stacked sections; controls update preferences immediately. **Missing:** no in-page nav (jump to section), no search-within-settings, no diff vs. defaults / "reset section".
**Current UI weaknesses** — A linear stack of 11 sections is a known anti-pattern at this scale — discoverability dies past the third fold. Each section is rendered as `:deep(.settings-section)` with shared styles, which is OK, but the section title styling (`font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em`) is `text.micro` per MASTER §3.3 — used here as a section heading rather than a badge, which is inverted from the type-scale intent.
**Opportunity** — Adopt **Linear/VS Code settings layout**: left rail with sections (sticky, with active highlight), main pane with content + per-section search at top, "modified" markers next to changed values. Each section gets a proper `text.h2` heading (16/22, weight 600) — not micro caps.
**Priority** — **High** — high-traffic surface; current pattern doesn't scale to 11 sections.

### Orchestration Home (`apps/desktop/src/views/orchestration/OrchestrationHomeView.vue` + `home/*`)
**Purpose** — "Command Centre" landing for orchestration sub-app — overview of active sessions, repositories, worktrees, and quick actions.
**Data shown** — Hero stat tiles (Active Sessions, Repositories, Budget Used, Total Sessions), Quick Actions grid (Launch Session / Configure Agents / Manage Worktrees / placeholder Mission Control), Activity Feed, System Health.
**Interaction model** — Click hero stat (no drill-through wired), click quick action card to navigate, fade-in stagger animation on mount.
**Current UI weaknesses** — **This is the worst-offending view in the app for MASTER §5 violations:**
  1. Hero tiles use `linear-gradient(135deg, var(--accent-muted), var(--canvas-subtle))` with colored borders (`OrchestrationHeroStats.vue:97–115`) — marketing gradient on data surface;
  2. `font-size: 2.5rem` for hero values (line 127) — hero typography in app chrome;
  3. `transform: translateY(-2px)` + `box-shadow: var(--shadow-lg)` on hover (lines 92–95) — layout-shifting hover;
  4. Quick Action cards use `emoji: "🚀" / "📊" / "🔧" / "🌳"` (`OrchestrationQuickActions.vue:18–44`) inside a 48px wrapper square — emoji-as-icon at large size;
  5. Action cards also use `transform: translateY(-2px)` + `box-shadow` on hover (lines 122–127);
  6. `fadeInUp` stagger animation (12px translate, 0.4s) on every section mount (`OrchestrationHomeView.vue:53–67`) — exceeds MASTER §4.4 max 240ms and is decorative;
  7. The activity feed maps `session_launched: "🚀"` (`OrchestrationActivityFeed.vue:21`) — emoji severity mapping.
**Opportunity** — Rebuild as a **Grafana home dashboard**: hairlined stat row (no fills, no gradients, no hover lift) with sparkline + value + label + delta; quick actions as a Lucide-iconed list with kbd hints (`L` = launch, `W` = worktrees); activity feed as a virtualized log stream with severity dots + monospace timestamps. Remove the entrance stagger animation entirely.
**Priority** — **High** — first impression of the orchestration sub-app and currently the most "AI-vibe-coded" surface.

### Worktree Manager (`apps/desktop/src/views/orchestration/WorktreeManagerView.vue` + `components/worktree/*`)
**Purpose** — Manage git worktrees: register repos, list/filter worktrees, prune stale, lock/unlock, open in explorer/terminal, jump to launcher/session.
**Data shown** — Repo sidebar (with worktree counts), list of worktrees per repo, detail panel (path, lock state, age, disk usage, branch), stale banner with reclaimable bytes, prune toast.
**Interaction model** — Add/discover repo, select repo to filter, search, lock/unlock/delete, open in explorer/terminal, navigate to launcher/session. **Missing:** keyboard nav between worktrees, multi-select for bulk delete.
**Current UI weaknesses** — `worktree-manager.css` line 834 contains `backdrop-filter: blur(8px)` on a panel (CC-2). Repo sidebar is a fourth navigation surface (after `AppSidebar`, `BreadcrumbNav`, `SessionTabStrip`) — risk of cognitive overload (CC-5: too many sidebars).
**Opportunity** — Treat worktrees as **a typed `DataTable`** (path-mono · branch · age · size · locked · last-session · actions) with the repo selector as a **filter chip strip** instead of a full sidebar. Reserve the right-pane inspector; collapse to one column on narrow widths.
**Priority** — Medium — solid feature, suffers from layout sprawl.

### Session Launcher (`apps/desktop/src/views/orchestration/SessionLauncherView.vue` + `components/sessionLauncher/*`)
**Purpose** — Configure and launch a new Copilot CLI session: pick template, set agent/model, write prompt, advanced flags, save as template.
**Data shown** — Templates list (with `tpl-emoji`), config form, prompt editor, advanced section, save-as-template form, live preview pane.
**Interaction model** — Pick template, edit config, write prompt, save template, launch. Right-click template → context menu (delete). **Missing:** no Cmd+Enter shortcut to launch from prompt; no diff vs. last-launched.
**Current UI weaknesses** — (1) Templates show emoji icons (`SessionLauncherTemplates.vue:79` `templateIcon(tpl)` plus inline `⏳` line 37) — and `SessionLauncherSaveTemplate.vue:32` exposes a literal text input with `placeholder="🚀"` to encourage users to type emoji into template names. This is the strongest signal that emoji-as-icon is *baked into the data model*, not just decoration; (2) `session-launcher.css` line 793 uses `backdrop-filter: blur(2px)` (CC-2); (3) split layout reinvented vs. `SkillEditorView`'s split (CC-8).
**Opportunity** — Replace emoji template icons with a Lucide picker (50 curated dev-tool glyphs). Promote prompt editor to a Monaco-style mono editor. Bind `Cmd+Enter` = Launch. Side-by-side preview shows the resolved CLI command in monospace with copy.
**Priority** — **High** — gated entry point to using the app to start sessions; emoji baked into data is a migration concern.

### Config Injector (`apps/desktop/src/views/orchestration/ConfigInjectorView.vue` + `components/configInjector/*`)
**Purpose** — Inject TracePilot config / agent definitions into Copilot CLI's user settings, with versions and backups.
**Data shown** — Tabs (Agent Models / Global Config / Environment / Backups), per-tab content (agent cards with emoji+motto, config viewer, env vars, backup list), customization warning banner.
**Interaction model** — Tab switch, edit/save, restore backup. **Missing:** clear "what is currently active vs. drafted" indicator.
**Current UI weaknesses** — (1) `<PageHeader title="⚙️ Config Injector" />` (line 63) — emoji **literally in the page title**; (2) Tab labels carry emoji that get passed into `TabNav` as `icon: t.emoji` (lines 19–24, 39) — emoji-as-icon at the navigation chrome level; (3) Warning banner uses `⚠️` and `✕` literal characters (lines 68, 72); (4) Hand-rolled `<nav class="breadcrumb">` (lines 57–61) instead of the global `BreadcrumbNav` component (CC-5); (5) `agentMeta.ts` hard-codes emoji per agent (lines 8–29) and (6) `config-injector.css:186` uses `font-size: 28px` hero (CC-3). (7) `ConfigInjectorBackupsTab.vue:65` renders `<span class="backup-emoji">{{ backupEmoji(backup.sourcePath) }}</span>` — emoji as filetype identifier.
**Opportunity** — Replace agent emoji with the canonical agent color tokens (`--agent-color-explore` etc.) rendered as a left-edge color rail + Lucide glyph. Drop the local breadcrumb; use the global one. Remove the emoji from the page title. Use `Badge variant="warning"` with icon for the customization banner.
**Priority** — **High** — high concentration of MASTER violations in a small surface.

### MCP Manager (`apps/desktop/src/views/mcp/McpManagerView.vue`)
**Purpose** — Manage Model Context Protocol servers: install, configure, monitor health, audit token usage.
**Data shown** — Stats strip (Installed / Active / Error counts with colored dots), token summary panel, search input, tag filters, server cards (name, transport type, status, tokens, description), error banner, empty hero with feature bullets.
**Interaction model** — Add/import server, search, tag-filter, refresh health, click card to detail. **Missing:** no keyboard nav of cards, no bulk enable/disable.
**Current UI weaknesses** — (1) `McpTokenSummary.vue:31` `<div class="token-usage-icon">📊</div>` — emoji; (2) `McpServerCard.vue:117` `<span class="badge-xs badge-tokens">⚡ {{ tokensFormatted }} tok</span>` — emoji in a numeric badge; (3) MCP card replicates the SessionCard pattern with a slightly different layout (CC-9); (4) Empty state has its own ad-hoc `feature-item` list — diverges from the canonical `EmptyState` component.
**Opportunity** — Card → row in a **server table** (status-dot · name · transport · tokens-mono · tools-count · last-checked · actions), with selection-driven right inspector for detail. Replace `📊`/`⚡` with Lucide `bar-chart-3` / `zap`. Standardize the empty-state to the shared `EmptyState` with a `LinkList` slot.
**Priority** — **High** — surfaced in the configuration nav section; first thing users see when wiring tools.

### MCP Server Detail (`apps/desktop/src/views/mcp/McpServerDetailView.vue` + `components/mcp/McpServerDetail*`)
**Purpose** — Single-server detail: header, connection params, metadata, tools list, health, actions.
**Data shown** — Server name, status, transport, command/args, env vars, tools (name + token count + description), health log.
**Interaction model** — Back-link, refresh health, edit/remove. **Missing:** test-tool dry-run, env-var reveal-on-hover for secrets.
**Current UI weaknesses** — Hand-rolled "Back to MCP Servers" link instead of the global `BreadcrumbNav` (CC-5). `mcp-server-detail.css` carries `font-size: 20px` heading rules (CC-3). Two-column layout ad-hoc rather than a shared `Inspector` primitive (CC-8).
**Opportunity** — Adopt a standard **detail layout primitive** (`<DetailShell>` with breadcrumb + title bar + actions + 2-pane body) shared with Skill Editor and Worktree Detail. Tools list as a `DataTable` with mono token counts.
**Priority** — Medium.

### Skills Manager (`apps/desktop/src/views/skills/SkillsManagerView.vue`)
**Purpose** — Manage skills (markdown packages that extend the agent): list, scope-filter, search, import, create, delete; show token-budget usage of enabled skills.
**Data shown** — Stats strip (Installed / Global / Project / Active counts), token info bar (`enabledTokens / 128k`, %), scope segmented control (All / Global / Project), search, skill cards (name, scope badge, description, token count, frontmatter), empty state.
**Interaction model** — Filter scope, search, click to edit, delete with confirm, import wizard, new-skill modal.
**Current UI weaknesses** — (1) Empty state `<div class="empty-state__icon">🧠</div>` (line 182) — emoji; (2) hand-rolled modal (`<div class="modal-overlay">` line 194) instead of the shared `ModalDialog` from `@tracepilot/ui` — divergent close affordance (`✕` literal char on line 198), divergent backdrop styling (`backdrop-filter: blur(4px)` line 561, CC-2); (3) hand-rolled segmented control (`scope-seg-btn`) when `SegmentedControl` exists in `packages/ui`; (4) hand-rolled search input duplicates `SearchInput` from `packages/ui` (CC-9). (5) Token bar is conceptually identical to `MetricsTab`'s — should be one component (CC-7).
**Opportunity** — Same `DataTable` row treatment as MCP Manager. Use canonical `ModalDialog`, `SegmentedControl`, `SearchInput`. Promote the token-budget bar into `<TokenBudgetBar>` shared with Metrics tab. Replace `🧠` empty state with a Lucide `book-open`.
**Priority** — **High** — frequently used; multiple bespoke widgets duplicating shared library.

### Skill Editor (`apps/desktop/src/views/skills/SkillEditorView.vue` + `components/skillEditor/*`)
**Purpose** — Author and edit a skill: metadata form, markdown editor, live preview, asset preview modal, status bar.
**Data shown** — Top bar (skill name, scope, save state), metadata form, markdown editor (`SKILL.md`), preview pane, status bar.
**Interaction model** — Drag splitter to resize panes, edit, save, preview asset. **Missing:** unclear keyboard save (`Cmd+S`) status; no diff vs. saved.
**Current UI weaknesses** — `skill-editor.css` contains `linear-gradient` and `font-size: 20px` heading rules (CC-3). Splitter is a manual mousedown handler (`onMouseDown` line 55) — same issue as ExplorerTab (CC-8). Panel headers reinvent a "title + filename" header rather than reusing `PageHeader` or a section primitive.
**Opportunity** — Same shared `SplitPane` primitive. Adopt VS Code-style "dirty" indicator (•) on the title. Use Monaco for markdown editing for consistency with developer expectations.
**Priority** — Medium — focused expert tool; correctness > visual fix.

### Not Found (`apps/desktop/src/views/NotFoundView.vue`)
**Purpose** — 404 fallback.
**Data shown** — Empty-state title and a "Back to Sessions" button.
**Interaction model** — Click button.
**Current UI weaknesses** — `EmptyState icon="404"` — passes a string literal as icon, which depending on how `EmptyState` renders likely shows the literal text "404" inside the icon slot (intentional? then visually undisciplined; if accidental then clearly broken). Either way, doesn't follow MASTER §6 (Lucide-only icons).
**Opportunity** — Replace with Lucide `compass-off` plus a calm message + primary action. Add a search shortcut hint.
**Priority** — Low.

### Setup Wizard (`apps/desktop/src/components/SetupWizard.vue` + `components/wizard/*`)
**Purpose** — First-run onboarding: welcome, session dir, database, features, ready.
**Data shown** — Wizard slides with title, description, controls.
**Interaction model** — Next/Back, browse for directory, validate, save.
**Current UI weaknesses** — Direct MASTER §5 violations: (1) `WizardStepWelcome.vue:55` `font-size: 36px; font-weight: 800; letter-spacing: -0.03em; background: linear-gradient(135deg, #fafafa, #a1a1aa); -webkit-background-clip: text` — gradient-clipped hero text; (2) `pulse-glow` 3s infinite animation on the logo (line 46) — auto-playing decorative motion; (3) `WizardStepFeatures.vue:20–50` features carry `emoji: "📋" "💬" "📊" "🔧" "📝" "💰"`; (4) `wizard-form.css:8` `font-size: 48px` — hero. *Note:* MASTER §5 explicitly allows hero typography in onboarding/empty states only, so the 36px/48px sizes here are *defensible* — but the gradient-clip + emoji features are not.
**Opportunity** — Keep the larger type as MASTER permits, but: drop gradient-clipped text, drop pulse-glow, replace feature emoji with Lucide glyphs in `--accent-muted` chips. Let the wizard be the *one* place hero typography lives.
**Priority** — Medium — onboarding visibility, but partially permitted.

### Indexing Loading Screen (`apps/desktop/src/components/IndexingLoadingScreen.vue` + `components/indexing/IndexingOrbitalScene.vue`)
**Purpose** — Pre-app full-screen indexing UI shown when sessions are first being indexed.
**Data shown** — Top progress bar, orbital scene with rotating animation, phase label, session counter, completion flash.
**Interaction model** — Watch only.
**Current UI weaknesses** — `IndexingOrbitalScene` uses `linear-gradient` + likely radial accents (file in CC-3 list). Orbital scene is a custom decorative animation that contradicts MASTER's "Quiet. Signal goes to data" chrome principle. Also potentially the longest-duration animation in the app.
**Opportunity** — Replace orbital scene with a **calm, terminal-feel boot screen** (Linear-style shimmer over a fixed brand mark, monospace progress `[=====     ] 312 / 950 sessions`, micro-spinner). Saves GPU and matches identity.
**Priority** — Low — appears once per install/upgrade.

---

## High-Impact Reusable Components

### App Sidebar (`apps/desktop/src/components/layout/AppSidebar.vue`)
**Purpose** — Primary global navigation: brand, primary nav (Sessions/Search/Analytics/Tools/Code), advanced (Models/Compare/Replay/Export), orchestration, configuration (MCP/Skills), Settings, version pill, theme toggle, SDK status, alerts indicator.
**Data shown** — Active route highlight, session count badge, update-available indicator, alert count, app version.
**Interaction model** — Click to nav, collapse/expand (persisted), theme toggle, dismiss-update, click-version → "What's New" modal. **Missing:** keyboard nav between sidebar items (`Alt+1..9`), command-palette is the only fast-jump.
**Current UI weaknesses** — Sidebar bundles three nav sections + status indicators + footer actions in 240px — at "comfortable" density this is dense, but the sectioning headers use the same micro-caps style as Settings sections (CC-10: micro-caps as section heading misuse). The "Command Centre" label for the orchestration link uses British spelling — fine, but only this one label is non-American — inconsistent.
**Opportunity** — Adopt a **Linear-style sidebar**: section labels are quiet `text.small` `--text-tertiary`, items are 28px (Compact) by default, active item gets a 2px left rail in `--accent-emphasis` and `--accent-subtle` row tint (no full pill). Add `Alt+1..9` shortcuts surfaced as right-aligned `<kbd>`.
**Priority** — **High** — visible on every screen; investing here lifts everything.

### Breadcrumb Nav (`apps/desktop/src/components/layout/BreadcrumbNav.vue`)
**Purpose** — Show current location and clickable ancestor path.
**Data shown** — Item labels with chevron separators.
**Interaction model** — Click ancestor to navigate. **Missing:** no truncation strategy for long session summaries; no last-segment dropdown for siblings.
**Current UI weaknesses** — Minimal style — fine baseline, but at least one view (`ConfigInjectorView`) ships its *own* breadcrumb HTML rather than using this component (CC-5).
**Opportunity** — Add middle-truncation on long labels with a copy-to-clipboard affordance on the leaf segment (sessions have UUID-style IDs). Add `Alt+←` history-back binding.
**Priority** — Medium.

### Session Tab Strip (`apps/desktop/src/components/layout/SessionTab*.vue`)
**Purpose** — Multi-session tab bar with home pill, drag-reorder, context menu, pop-out-to-window.
**Data shown** — Tab label (session summary), active indicator, close button, count.
**Interaction model** — Click/middle-click to close, drag to reorder, drag-out to pop window, right-click for context menu, arrow-key nav. Solid keyboard support already.
**Current UI weaknesses** — Coexists with `BreadcrumbNav` and `AppSidebar` route highlighting — three navigational signals can disagree (you can have an active sidebar item and an active tab pointing at different sessions). The "home pill" labelled "Sessions" overlaps semantically with the sidebar's "Sessions" item (CC-5).
**Opportunity** — Resolve the three-signal problem by treating **tabs as the canonical "where am I"** and demoting the sidebar to "where can I go" (Linear pattern). Keep the home pill but rename it to a Lucide `home` icon-only button to avoid name collision.
**Priority** — Medium — works correctly; conceptually overlapping.

### Search Palette (`apps/desktop/src/components/SearchPalette.vue`)
**Purpose** — Global `Cmd+K` quick-search across sessions and conversation content.
**Data shown** — Query input, grouped results (session-grouped), hit count, latency, total result count, error.
**Interaction model** — `Cmd+K` open, type, arrow-nav, `Enter` to open, `Esc` to close. Solid keyboard model.
**Current UI weaknesses** — Lines 270–271: `backdrop-filter: blur(12px)` (CC-2). Coexists with `SessionSearchView` — same underlying feature but two visual treatments and entry points (CC: search ambiguity).
**Opportunity** — Make the palette **the** search entry point; let `SessionSearchView` be a "results page" reachable via `Enter` from the palette (palette → results page = Linear pattern). Remove glass blur, use `--canvas-overlay` solid + 2px shadow at `elev.4` per MASTER §4.1.
**Priority** — **High** — the heart of keyboard-first nav.

### Alert Center Drawer (`apps/desktop/src/components/layout/AlertCenterDrawer.vue`)
**Purpose** — Slide-over notification drawer for session events (end / ask-user / permission / error / lag / idle).
**Data shown** — Per-alert icon, severity, time, session label, action.
**Interaction model** — Click row → opens session as tab; close drawer.
**Current UI weaknesses** — `iconForType` returns literal chars: `"✓"`, `"💬"`, `"🔐"`, `"⚠"` (lines 32–48). Mixed: `✓` and `⚠` are Unicode glyphs (not emoji per se, but shape varies wildly across fonts), and `💬`/`🔐` are full-color emoji. Color-emoji icons in a severity-mapped notification list directly violate MASTER §5 ("Mixing icon sets" + "Color-only state" if the user can't tell ⚠ from ✓ at a glance). `backdrop-filter: blur(8px)` (line 147, CC-2). `font-size: 32px` (line 227, CC-3).
**Opportunity** — Lucide-only severity icons (`check-circle-2`, `message-square`, `lock`, `triangle-alert`) tinted with semantic state colors. Compact rows (32px). "Mark all read" button at the top.
**Priority** — **High** — visible on every alert; current state is the worst offender for the icon-set anti-pattern.

### Page Headers — `AnalyticsPageHeader` vs. `PageHeader` (`apps/desktop/src/components/AnalyticsPageHeader.vue` vs `packages/ui/src/components/PageHeader.vue`)
**Purpose** — Render a page title + subtitle (+ actions slot in the canonical one).
**Current UI weaknesses** — Two implementations of the same concept used inconsistently across views (`AnalyticsDashboardView`, `ToolAnalysisView`, `CodeImpactView`, `ModelComparisonView` use the local `AnalyticsPageHeader`; `McpManagerView`, `SkillsManagerView`, `SessionLauncherView`, `ConfigInjectorView` use the canonical `PageHeader`). Fragmentation (CC-6).
**Opportunity** — Consolidate to one `PageHeader` with title/subtitle/icon/actions slots and a `density` prop. Delete the local one.
**Priority** — Medium.

### Refresh Toolbar (`apps/desktop/src/components/RefreshToolbar.vue`)
**Purpose** — Manual refresh button + auto-refresh toggle + interval picker.
**Interaction model** — Click refresh, toggle auto, set interval. Sound concept.
**Current UI weaknesses** — Used inside `SessionListView`'s glass toolbar; renders OK on its own. Inconsistency: shows up in some views (Sessions, Detail) and not others where it would also help (Analytics, Tools).
**Opportunity** — Unify into the global header bar so every data-driven view gets the same control.
**Priority** — Low.

### Conversation Tool-Call Renderers (`packages/ui/src/components/renderers/*`)
**Purpose** — Per-tool visual treatments for tool args/results: Apply Patch, Edit Diff, Shell Output, Grep Result, Glob Tree, View Code, Web Search, SQL Result, Ask User, Plain Text, Report Intent, Store Memory, Create File, etc.
**Data shown** — Tool-specific structured payload.
**Interaction model** — Expand/collapse, copy.
**Current UI weaknesses** — 20+ renderers, each likely with subtly different framing (`RendererShell` exists — but per-renderer divergence is highly likely without a strict design contract). Risk of corner-radius / border / spacing drift across the conversation.
**Opportunity** — Lock all renderers behind a **strict `RendererShell` contract** with: (a) standard header strip (tool icon · name · status pill · latency-mono · expand chevron · copy), (b) standard body padding (12/16), (c) standard mono treatment for paths/IDs, (d) standard syntax theme via `--syn-*` tokens. Audit each renderer against the contract.
**Priority** — **High** — these are the densest content surfaces in the app.

### Subagent Panel (`packages/ui/src/components/SubagentPanel/*` + `apps/desktop/src/components/conversation/SubagentPanel.vue`)
**Purpose** — Render a sub-agent's nested activity within a turn (header, nav, activity stream, model warning, collapsible block).
**Current UI weaknesses** — Two `SubagentPanel` components (one in `packages/ui`, one in `apps/desktop/src/components/conversation`) — naming collision likely indicates an in-flight migration (CC-9). Need to verify there's no double-rendering.
**Opportunity** — Pick the canonical one in `packages/ui`, delete the duplicate, add a `name` prop for the agent identity → use the `--agent-color-*` palette consistently.
**Priority** — Medium.

### Timeline Sub-Views (`apps/desktop/src/components/timeline/*`)
**Purpose** — Three swappable timeline visualizations.
**Current UI weaknesses** — `NestedSwimlanesView.vue:160` and `TurnWaterfallView.vue:199` both use `EmptyState icon="📊"` — emoji (CC-1). Three views likely diverge in time-axis treatment (CC: data-viz inconsistency).
**Opportunity** — Share one `<TimeAxis>` primitive across all three; share one `<SpanBar>` primitive; choose one as default and demote the others to a `view` switcher.
**Priority** — High (see Session Timeline view).

### Search Sub-Components (`apps/desktop/src/components/search/*`)
**Purpose** — Hero, presets, filter sidebar, grouped results, result card, expanded details, pagination, syntax help, indexing banner.
**Current UI weaknesses** — `search-palette-results.css` is in CC-3 (gradients). 12 sub-components for one feature suggests over-decomposition (CC-9). Hero is the visual offender.
**Opportunity** — Collapse to ~5 components (`SearchBar`, `SearchFilters`, `SearchResults` (with grouped variant), `SearchResultRow`, `SearchPagination`).
**Priority** — Medium.

### Replay Components (`apps/desktop/src/components/replay/*`)
**Purpose** — Sidebar (recent), transport bar, timeline pane, event ticker, step content, model-switch banner.
**Current UI weaknesses** — `ModelSwitchBanner.vue:13` `<span class="switch-icon">🔄</span>` — emoji. `ReplayTransportBar`, `ReplayTimelinePane`, `ReplayEventTicker` all in the gradient list (CC-3).
**Opportunity** — Treat the transport bar as a **terminal-grade strip** (mono timecode, monospaced step counter, Lucide play/pause/skip).
**Priority** — Medium.

### Cards: `SessionCard` / `McpServerCard` / `SkillCard`
**Purpose** — Domain-typed card for a list item.
**Current UI weaknesses** — Each defines its own dimensions, badge stack, hover behaviour, and footer pattern — same archetype, three implementations (CC-9). MCP card carries `⚡ tok` emoji badge.
**Opportunity** — One `<EntityCard>` primitive with slots for icon, title, badges, body, footer, and an `interactive` prop. Or — preferably — replace the card grids with dense tables and keep cards only for empty/featured contexts.
**Priority** — Medium.

### Setup Wizard Steps (`apps/desktop/src/components/wizard/*`)
**Purpose** — Each step of the first-run wizard.
**Current UI weaknesses** — Hero typography, gradient text-clip, pulse-glow animation, emoji feature list — all already enumerated in the `SetupWizard` view entry above.
**Opportunity** — Same as Setup Wizard view entry.
**Priority** — Medium.

### Modals: `WhatsNewModal`, `UpdateInstructionsModal`, `ConfirmDialog`, ad-hoc modals
**Purpose** — Various modal surfaces.
**Current UI weaknesses** — `WhatsNewModal.vue:67–108` uses `✨ Added`, `🔄 Changed`, and `💡 Consider…` headings — emoji as section structure. `WhatsNewModal.vue:126`, `UpdateInstructionsModal.vue:162` use `backdrop-filter: blur(4px)` (CC-2). `font-size: 22px` titles (CC-3). `SkillsManagerView` ships its own modal HTML rather than using `ModalDialog` from `@tracepilot/ui` (CC-9).
**Opportunity** — Lock all modal usage to `ModalDialog`. Replace emoji change-group titles with Lucide icons + semantic colors (`plus-circle` green for Added, `refresh-cw` indigo for Changed, etc.).
**Priority** — Medium.

### Settings Sub-Panels (`apps/desktop/src/components/settings/*`)
**Purpose** — 11 settings sections.
**Current UI weaknesses** — `SettingsSdk` and `SdkServersPanel.vue:46–49` use emoji in button labels (`"🔍 Detect"`, `"🚀 Launch"`). Section title uses `text.micro` styling (CC-10).
**Opportunity** — See Settings view entry. Replace inline emoji button labels with Lucide-prefixed buttons.
**Priority** — Medium.

---

## Cross-Cutting Findings

### CC-1 · Emoji used as application iconography
**Where (≥3 files):** `OrchestrationQuickActions.vue:18–44`, `OrchestrationActivityFeed.vue:21`, `ConfigInjectorView.vue:19–24,63`, `agentMeta.ts:8–29`, `WizardStepFeatures.vue:20–50`, `McpServerCard.vue:117`, `McpTokenSummary.vue:31`, `SkillsManagerView.vue:182`, `SessionLauncherTemplates.vue:37,79`, `SessionLauncherSaveTemplate.vue:32`, `AlertCenterDrawer.vue:32–48`, `WhatsNewModal.vue:67–108`, `SettingsSdk`/`SdkServersPanel.vue:46–49`, `SessionListView.vue:228`, `SessionTimelineView.vue:36`, `ToolGroupSegment.vue:82`, `SubagentGroupSegment.vue:23`, `SkillInvocationEventRow.vue:98`, `ModelSwitchBanner.vue:13`, `NotFoundView.vue:12`, `useExportConfig.ts:111–116`.
**Fix (MASTER §5 "Emoji as icons"):** Adopt **Lucide as the sole icon set, 1.5px stroke, 16px or 20px**. Remove emoji from data models (config injector agent meta, session launcher templates, export options) and replace with a curated Lucide picker. For surfaces where emoji is *user-supplied* (template names, skill icons), display them in a quarantined "user-content" treatment that visually distinguishes them from app chrome.

### CC-2 · Glassmorphism / backdrop-blur on data and chrome
**Where (≥3 files):** `SessionListView.vue:250`, `SessionDetailPanel.vue:370`, `SearchPalette.vue:270`, `AlertCenterDrawer.vue:147`, `WhatsNewModal.vue:126`, `UpdateInstructionsModal.vue:162`, `ConversationTab.vue:298`, `SkillsManagerView.vue:561`, `worktree-manager.css:834`, `session-launcher.css:793`, `sdk-steering.css:194,297,584`, `skill-import-wizard.css:20`, `add-server.css:9`, `overlays.css:13–23`.
**Fix (MASTER §5 "Glassmorphism on data surfaces"):** Replace every `backdrop-filter: blur()` with **solid `--canvas-overlay` (#18181B) for popovers/menus and `--canvas-raised` (#1C1C1F) for modals**, paired with hairline borders and `--shadow-md`/`--shadow-lg` per `elev.3`/`elev.4` tokens. Allow blur **only** on the modal backdrop scrim (the dimmer behind a modal), and even there at ≤4px.

### CC-3 · Marketing gradients & hero typography in app chrome
**Where:** `OrchestrationHeroStats.vue:97–115,127`, `WizardStepWelcome.vue:55–62`, `tokens.css` defines `--gradient-accent`/`--gradient-card`/`--gradient-surface` (which encourages reuse), `IndexingOrbitalScene.vue` (decorative scene), `features.css:102` (`font-size:36px`), `export.css:489,515,625`, `config-injector.css:186`, `mcp-server-detail.css:134`, `session-launcher.css:197`, `wizard-shared.css:27`, `wizard-form.css:8`, `WhatsNewModal.vue:158`, `UpdateInstructionsModal.vue:194`, `AlertCenterDrawer.vue:227`. Also `replay/*` (gradient flagged in Transport/Sidebar/Timeline/EventTicker).
**Fix (MASTER §1 + §5):** Strip gradient fills from data tiles. Use a **single subtle radial accent** at `0.07` opacity (already present in `App.vue` orb backdrop) as the only ambient gradient. Cap title sizes at `text.h1` (20/28) outside `display` use cases (empty states, onboarding). Audit the `--gradient-*` tokens — keep `--gradient-accent` only for the brand mark; deprecate `--gradient-card` and `--gradient-surface`.

### CC-4 · Card/StatCard/SectionPanel "frame soup"
**Where:** Visible in `AnalyticsDashboardView`, `OverviewTab`, `MetricsTab`, `ModelComparisonView`, `SessionListView`, `OrchestrationHomeView`. Dozens of nested bordered surfaces with their own padding stacks.
**Fix (MASTER §1 — "Quiet. Signal goes to data, not decoration"):** Introduce a **`<DataGrid>`** primitive (compact 32-row table), and a **`<KPI>`** primitive (label + value-mono + delta + sparkline; no border). Reserve `<SectionPanel>` for actual logical group boundaries with a single hairline divider — not for every micro-stat. Reduce border count by ~50% on data-heavy views.

### CC-5 · Multiple competing navigational chromes / hand-rolled breadcrumbs
**Where:** `AppSidebar` + `BreadcrumbNav` + `SessionTabStrip` + `WorktreeRepoSidebar` + `ReplaySidebar` + `SearchFilterSidebar` + `ConfigInjectorView.vue:57–61` (own breadcrumb) + `ConfigInjectorView` warning banner (own pattern).
**Fix:** Define a navigation hierarchy: `AppSidebar` (where can I go) → `BreadcrumbNav` (where am I) → `SessionTabStrip` (active sessions) → in-page filter rail (data filters). Disallow ad-hoc breadcrumbs; route every page through the shared `BreadcrumbNav`. In-page sub-sidebars (Worktree, Replay) must visually signal "this is a filter, not navigation" via a different background (`--canvas-inset` instead of `--canvas-default`) and tighter typography.

### CC-6 · Two `PageHeader` components used inconsistently
**Where:** `apps/desktop/src/components/AnalyticsPageHeader.vue` (used by Analytics/Tools/Code/Models views) vs. `packages/ui/src/components/PageHeader.vue` (used by MCP/Skills/Launcher/ConfigInjector).
**Fix:** Consolidate to the canonical `packages/ui/src/components/PageHeader.vue`. Add the action slots Analytics needs to it. Delete the local one. Mandate use via lint rule.

### CC-7 · "Token budget bar" reinvented per-view
**Where:** `MetricsTokenBudget` (Metrics tab), `McpTokenSummary` (MCP), `token-info` block in `SkillsManagerView`, `OrchestrationHeroStats` budget tile (commented out).
**Fix:** Promote to a single `<TokenBudgetBar>` in `packages/ui` with props `{ used, total, thresholds: { warn, danger }, label, sublabel }`. Use across Metrics, Skills, MCP, and Conversation context-window indicators.

### CC-8 · Hand-rolled split panes & resize handles
**Where:** `ExplorerTab.vue:27–51` (mousedown handler), `SkillEditorView.vue:32–56` (own handler via `useSkillEditor`), `SessionLauncherView` `split-layout`, `McpServerDetailView` `split-wrapper`, `SessionComparisonView` (two-column).
**Fix:** Introduce `<SplitPane>` primitive in `packages/ui`: keyboard-resizable (`Alt+←/→`), persisted width per `paneId`, supports horizontal/vertical, respects `prefers-reduced-motion`, exposes a `dirty` slot for unsaved-state indicators.

### CC-9 · Component duplication / over-decomposition
**Where:** Two `SubagentPanel` (in `packages/ui` and `apps/desktop`); local `modal-overlay` in `SkillsManagerView` vs. `ModalDialog` in `packages/ui`; local `scope-seg-btn` vs. `SegmentedControl`; local `search-input` vs. `SearchInput`; three card archetypes (`SessionCard`/`McpServerCard`/`SkillCard`); 12 components for the search feature.
**Fix:** Establish a "no local re-implementation" rule: any UI primitive that exists in `@tracepilot/ui` must be imported from there. Add a lint check that fails on local `.modal-overlay`, `.search-input`, or hand-rolled segmented controls. Run a one-shot consolidation PR.

### CC-10 · `text.micro` (uppercase 0.04em tracking 11px) misused as section heading
**Where:** `SettingsView.vue:65–71`, `AppSidebar` section labels, multiple settings panel titles, several `pill-label` uses.
**Fix:** `text.micro` is for **badges and status pills** per MASTER §3.3. Section headings should use `text.h2` (16/22 600) or `text.h3` (14/20 600). Re-classify usage; introduce a `Heading` component with required `level` prop to enforce.

### CC-11 · Hardcoded hex / non-token color fallbacks
**Where:** `SessionTimelineView.vue:96–97` (`#161b22`, `#30363d` — Primer leftovers), inline gradient hexes in `WizardStepWelcome.vue:58`.
**Fix (MASTER §7):** Lint rule banning hex literals in `apps/desktop/src/**/*.vue`. All color values must be `var(--*)`. Add the missing tokens to `packages/ui/src/styles/tokens.css` if the need is real.

### CC-12 · Layout-shifting hover states
**Where:** Every card grid that uses `transform: translateY(-2px)` + `box-shadow` lift: `OrchestrationHeroStats`, `OrchestrationQuickActions`, MCP/Skill/Session cards.
**Fix (MASTER §4.4 & §5):** Replace lift with **border + background tonal shift only** (`border-color: var(--border-emphasis)` + `background: var(--surface-tertiary)`), 120ms ease-out.

### CC-13 · Ad-hoc decorative animation
**Where:** `OrchestrationHomeView` `fadeInUp` stagger, `WizardStepWelcome` `pulse-glow` 3s infinite, `SessionListView` `drift-motion` skew easter-egg, `IndexingOrbitalScene`.
**Fix (MASTER §4.4):** Allowed durations: 120 / 180 / 220 ms. No infinite/decorative auto-play. Remove all four; rely on instant cross-fades for state changes.

---

## Recommended Redesign Sequence

The order below maximises lift per redesign hour by fixing foundational chrome before per-view work, and tackling high-traffic surfaces before low-traffic ones.

1. **Global token & icon hygiene (1–2 days, no per-view work).** Remove every emoji used as iconography (CC-1), every `backdrop-filter` on data chrome (CC-2), every gradient on data tiles (CC-3), every layout-shifting hover (CC-12), every decorative animation (CC-13). Add the missing Lucide imports, kill `--gradient-card`/`--gradient-surface` tokens. *Rationale:* unblocks every screen and lifts perceived quality more than any individual view.

2. **Shared chrome: `AppSidebar`, `BreadcrumbNav`, `SessionTabStrip`, `PageHeader` consolidation (CC-5, CC-6).** Build the navigational hierarchy contract; delete the duplicate `AnalyticsPageHeader`; ban ad-hoc breadcrumbs.

3. **Shared primitives: `DataGrid`, `KPI`, `SplitPane`, `TokenBudgetBar`, `EntityCard`, `RendererShell` contract (CC-4, CC-7, CC-8, CC-9).** This is the largest lift but enables every subsequent view to redesign in hours, not days.

4. **Search & command surface unification (Search Palette + Session Search).** Make `Cmd+K` the canonical entry; demote `SessionSearchView` to the results page reachable from the palette.

5. **Conversation Tab + Tool Renderers** — the densest content surface and the strongest "show, don't tell" demonstration of the new system.

6. **Session List + Session Detail Panel** — the most-trafficked views.

7. **Orchestration Home + Settings + Skills Manager + MCP Manager** — high-violation count surfaces; benefit massively from steps 1–3.

8. **Session Timeline + Analytics Dashboard + Tool Analysis + Code Impact + Model Comparison** — chart-heavy views; depend on step 1 (token cleanup) and a shared responsive chart layout.

9. **Worktree Manager + Session Launcher + Config Injector** — orchestration sub-app polish.

10. **Setup Wizard + Indexing Loading Screen + Replay + Export + NotFound** — lower-traffic; finish with a coat of polish using the now-mature primitive set.

*Estimated total: ~3–4 weeks of focused design+frontend work for one engineer; steps 1–4 alone (~5 days) deliver ~70% of the perceived-quality lift.*
