# Components

The app chrome and the shared primitives as they exist today. Rules for colour,
type, motion and icons are in [MASTER.md](MASTER.md). Props listed here are the
main ones; the component source is authoritative.

Before writing a local version of something below, use the shared one. If it
can't do what you need, extend it in `packages/ui` rather than forking it.

---

## App chrome

The desktop shell is `apps/desktop/src/App.vue`: sidebar on the left, then a
chrome row with the breadcrumb and session tab strip, then the routed view.

### Sidebar

`apps/desktop/src/components/layout/AppSidebar.vue`. Items come from each
route's `meta.sidebar` (`section`, `label`, `icon`, `order`) in
`apps/desktop/src/router/index.ts`, so add a page there rather than in the
sidebar.

| Section | Items |
|---|---|
| (unlabelled) | Sessions, Search, Analytics, Tools, Code |
| Advanced | Models, Compare, Replay, Export |
| Orchestration | Command Centre, Worktrees, Launcher |
| Configuration | MCP Servers, Skills, Agents, CLI Context, Config Injector |

Feature flags hide some items. The active item has a short accent bar on its
left edge. The footer holds the alerts bell and the theme toggle. Collapse state
is stored under the `tracepilot-sidebar-collapsed` key.

### Breadcrumb

`packages/ui/src/components/BreadcrumbNav.vue` (props `crumbs`, `maxCrumbs`,
`maxLabelChars`), wrapped by `apps/desktop/src/components/layout/BreadcrumbNav.vue`.
Long labels are middle-truncated. There is one breadcrumb, in the chrome row;
views don't render their own.

### Session tab strip

`apps/desktop/src/components/layout/SessionTabStrip.vue` and `SessionTab.vue`.
Home is an icon-only tab. The active tab uses the folder-tab style
(`--canvas-subtle` background, border, weight 600). The context menu offers
Close, Close Others, Close All and Pop Out. Ctrl/Cmd+click on a session opens it
in a new tab.

### Search palette

`apps/desktop/src/components/chrome/SearchPalette.vue`, built on `ModalDialog`.
Ctrl/Cmd+K opens it. It is a jump-to palette with recent items and session
search results; the full search page is `/search`.

### Alert center

`apps/desktop/src/components/chrome/AlertCenterDrawer.vue`, a 400px right-hand
drawer opened from the sidebar bell or Ctrl/Cmd+Shift+A. Alerts are grouped by
severity, use Lucide icons per kind, and can be marked read.

### Keyboard help

`apps/desktop/src/components/chrome/KbdHelpOverlay.vue` opens on `?` or
Ctrl/Cmd+/ and lists every shortcut registered through `useShortcut`
(`apps/desktop/src/composables/useShortcut.ts`).

---

## Page structure

| Component | Use | Main props |
|---|---|---|
| `PageShell` | Outer wrapper for a routed view | `fluid` |
| `PageHeader` | The one page header: title, subtitle, Lucide icon, status, actions slot | `title`, `subtitle`, `iconName`, `status`, `size`, `density`, `sticky` |
| `SectionPanel` | Titled card for a block of content | `title`, `padding` |
| `Heading` | Semantic headings at the sizes in MASTER §2 | `level` (1–4), `as`, `weight`, `truncate`, `mono` |

`AnalyticsPageHeader` (desktop) wraps `PageHeader` and adds the source switch and
time-range filter for the analytics pages. That wrapper is the sanctioned
pattern; don't add a second header component.

## Navigation and input

| Component | Use | Main props |
|---|---|---|
| `TabNav` | Tab bar, including the session detail tabs | `tabs`, `modelValue`, `variant` |
| `SegmentedControl` | Two to five mutually exclusive options | `modelValue`, `options`, `rounded` |
| `BtnGroup` | Older segmented buttons; prefer `SegmentedControl` in new code | |
| `SearchInput` | Search box with icon and clear button | |
| `Select`, `SearchableSelect`, `FilterSelect` | Dropdowns | |
| `Field` | Label, description and error around one control | `label`, `description`, `for`, `layout`, `status`, `errorMessage` |
| `FormInput`, `FormSwitch` | Text input and toggle | |

## Status and feedback

| Component | Use | Main props |
|---|---|---|
| `StatusPill` | Compact state label; always text plus tone | `tone`, `label`, `size`, `variant` |
| `Badge` | Metadata chips; `claude` variant marks Claude Code | `variant` |
| `Banner` | Inline notice at the top of a view or section | `tone`, `title`, `dismissible`, `iconName`, `role` |
| `EmptyState` | Empty and no-results states: say why, offer the next step | `title`, `description`, `size`, `primaryAction`, `secondaryAction` |
| `ErrorState`, `ErrorAlert` | Error with cause and recovery | |
| `SkeletonLoader`, `LoadingSpinner`, `ProgressBar` | Loading | |
| `Tooltip` | Secondary detail on hover or focus | `text`, `position` |
| `ToastContainer` | Async results and errors | |

## Overlays

| Component | Use | Main props |
|---|---|---|
| `ModalDialog` | Modal with focus trap and Esc | `visible`, `title`, `role`, `width` |
| `ConfirmDialog` | Confirm a destructive or surprising action | |
| `Drawer` | Side panel | `visible`, `placement`, `width`, `title`, `modal` |

Use these instead of local `.modal-overlay` markup.

## Data display

| Component | Use | Main props |
|---|---|---|
| `KPI`, `KPIRow` | Metric tiles on a hairline row, with optional delta and sparkline | `label`, `value`, `unit`, `format`, `delta`, `state` |
| `StatCard` | Older metric tile, still common; prefer `KPI` in new code and don't use `gradient` | |
| `ChartCard`, `ChartFrame`, `ChartTooltip` | Chart container with its own loading, empty and error state | `title`, `state`, `span`, `ariaSummary` |
| `DataTable` | Simple sortable table | `columns`, `rows`, `sortKey`, `sortDirection` |
| `SessionCard` | Session list card, with a Claude Code variant | |
| `DefList`, `TagList`, `TokenBar`, `MiniTimeline` | Small data helpers | |
| `MarkdownContent`, `FileContentViewer`, `FileBrowserTree` | Rendered content | |
| `UserContentEmoji` | Renders user-typed emoji as data (MASTER §5) | `text`, `emojiOnly` |

## Session content

| Component | Use |
|---|---|
| `RendererShell` | Frame for every rich tool result: tool name, icon (`#icon` slot), status tint, duration, copy, collapse. Body in the default slot, view switches in `#tabs`, footer in `#footer`; emits `retry`. |
| `RendererTruncationFooter` | "Load full output" footer for truncated results |
| `ToolCallItem`, `ToolCallDetail`, `ToolDetailPanel` | Tool call rows and details |
| `ReasoningBlock`, `ReasoningText` | Model reasoning |
| `SubagentPanel/` | Subagent activity panel; the desktop `components/conversation/SubagentPanel.vue` hosts it |
| `ObjectiveBanner` | Session objective at the top of the conversation |
| `AgentBadge` | Agent name with its `--agent-color-*` |

How to add a tool renderer is in
[Adding tool renderers](../docs/design/adding-tool-renderers.md).
