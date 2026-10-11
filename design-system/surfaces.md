# Surface notes

Short notes for individual views: what they show today, decisions worth keeping,
and the main gaps against [MASTER.md](MASTER.md). Where a view isn't listed,
MASTER and [components.md](components.md) are enough.

Replay, MCP Servers, Config Injector and SDK steering are experimental or
deprioritised (see [focus.md](../docs/agents/focus.md)). Follow the global rules
there but don't invest in redesigning them.

---

## Session list

`apps/desktop/src/views/SessionListView.vue`

- A card grid of `SessionCard`, with a Claude Code variant. Off-screen cards
  skip rendering with `content-visibility: auto`; there is no list
  virtualisation.
- Toolbar: repository filter, a source switch (only when more than one source is
  enabled), a sort select, search, and refresh. Indexing shows a progress bar.
- Empty states distinguish "no sessions yet", "empty sessions are hidden" and
  "no matching sessions", and the copy names the enabled sources.
- Ctrl/Cmd+click opens a session in a new tab.
- Searching for `67` plays a short drift animation. It is intentional.
- Gaps: the sticky toolbar uses `backdrop-filter`; the sort control is a native
  `<select>` next to styled filters.

## Session detail shell

`apps/desktop/src/components/session/SessionDetailPanel.vue`, used by both the
routed view and session tabs or pop-out windows.

- Tabs are defined in `apps/desktop/src/config/sessionTabs.ts`: Overview,
  Conversation, Events, Todos, Metrics, Context, Explorer, Timeline. A tab with
  `requires` only shows when the session's source has that capability.
- Header: title, source and metadata badges, then the actions row: Copy Resume
  Command, Resume in Terminal (when the source supports it), Open Folder,
  Export, Replay, and the refresh toolbar. Resuming a session that is active
  elsewhere asks for confirmation first.
- Gaps: the sticky actions bar uses `backdrop-filter`; the running indicator
  changes the header height when it appears.

## Conversation tab

`apps/desktop/src/views/tabs/ConversationTab.vue`

- Three view modes: Chat, Compact and Timeline (`ConversationViewSwitcher`).
  The tab owns `useToolResultLoader`, so loaded results survive a mode switch.
- Every rich tool result renders inside `RendererShell`. Tool, subagent and
  skill groups use Lucide icons (`Target`, `Zap`).
- Deep links scroll to an event through `useConversationNavigation`.
- Claude Code adds task notification cards and pasted-content blocks.
- Gaps: the scroll-to-top/bottom buttons use `backdrop-filter`.

## Session timeline

`apps/desktop/src/views/SessionTimelineView.vue`

- Views: Swimlanes, Waterfall, Agent Tree (the default) and Messages, which only
  appears when the session has subagents.
- Lane colour comes from `--agent-color-*`; outcome colour from state tokens.
- Gaps: the view switch is `BtnGroup` rather than `SegmentedControl`; the agent
  icon map in `packages/ui/src/utils/agentTypes.ts` still uses emoji.

## Search

`apps/desktop/src/views/SessionSearchView.vue` and the palette
(`components/chrome/SearchPalette.vue`).

- The palette is for jumping; `/search` is for full results and filters.
- The URL is the source of truth for the query and filters
  (`composables/useSearchUrlSync.ts`), so searches can be linked and restored.
- Results support j/k and Enter (`useSearchKeyboardNavigation`).
- Gaps: gradients in `styles/features/session-search.css` and the palette
  results; hover lift on browse presets.

## Analytics

`apps/desktop/src/views/AnalyticsDashboardView.vue` and the Tools, Code and
Models views, all headed by `AnalyticsPageHeader`.

- Cost is shown in one USD scale across sources.
- Chart colours follow MASTER §1; charts use the shared `useChartTooltip`.
- Each card should load, empty and fail on its own, without blanking the page.
- Gaps: stat tiles are `StatCard` with gradients rather than `KPI`; charts use a
  fixed layout instead of resizing with their card.

## Settings

`apps/desktop/src/views/SettingsView.vue` renders twelve sections in this order:

| # | Section | Panel |
|---|---|---|
| 1 | General | `SettingsGeneral.vue` |
| 2 | Appearance | `SettingsAppearance.vue` |
| 3 | Data & Storage | `SettingsDataStorage.vue` |
| 4 | Logs & Diagnostics | `SettingsLogging.vue` |
| 5 | AI Credit Tracking | `SettingsPricing.vue` |
| 6 | Tool Visualization | `SettingsToolVisualization.vue` |
| 7 | Updates | `SettingsUpdates.vue` |
| 8 | Additional Features | `SettingsExperimental.vue` |
| 9 | Claude Code | `SettingsClaudeCode.vue` |
| 10 | Alerts & Notifications | `SettingsAlerts.vue` |
| 11 | Copilot SDK Bridge | `SettingsSdk.vue` |
| 12 | About | `SettingsAbout.vue` |

- Appearance owns theme, content width and UI scale. There is no density
  setting.
- Additional Features groups flags under Recommended and Experimental headers.
- An experimental session source gets its own section through
  `SettingsProviderSection.vue` (title, Experimental header, enable switch, and
  its rows only while enabled), not more rows under Additional Features. Claude
  Code is the first.
- Per-source format diagnostics live under Logs & Diagnostics, one collapsed
  panel per source (`FormatDiagnosticsPanel.vue`).
- Gaps: section titles are uppercase micro text, and rows use local
  `.setting-row` styles instead of `Field`.

## Command Centre (orchestration home)

`apps/desktop/src/views/orchestration/OrchestrationHomeView.vue`

- Quick actions and the activity feed use Lucide icons.
- Gaps: hero stat tiles with gradients, hover lift and oversized numbers; a
  fade-in-up entrance animation; a placeholder action and mock feed entries.

## Session launcher

`apps/desktop/src/views/orchestration/SessionLauncherView.vue`

- A readiness `Banner` explains what's missing before launch.
- Template icons are user-chosen emoji, rendered as data under
  `allow-emoji`.
- Gaps: the delete confirmation overlay uses `backdrop-filter`; template
  reordering uses ▲▼ glyph buttons; section titles aren't `Heading`.

## Skills

`apps/desktop/src/views/skills/SkillsManagerView.vue` and `SkillEditorView.vue`

- Filters reuse `components/definitions/DefinitionFilters.vue` (shared with
  Agents); the editor reuses the definition editor panes.
- The empty state is `EmptyState` with a Lucide icon.
- Gaps: the new-skill modal is a local overlay with a blurred scrim rather than
  `ModalDialog`; the editor's split pane is hand-rolled.
