# AI Agent Task System — UI/UX Design Decisions

> TracePilot v0.6.1 · Task System Prototypes  
> Reference: [`docs/ai-agent-task-system.md`](../../../ai-agent-task-system.md)

---

## 1. Design Philosophy

### 1.1 "Mission Control" Metaphor

The task system UI is designed around a **mission control** metaphor — the user is an operator
overseeing autonomous AI agents. This influences every design choice:

- **Dashboard as command center**: Stats, orchestrator status, and task queue all visible at a glance
- **Real-time event streams**: Live telemetry from the orchestrator displayed as a scrolling log
- **Progress as observable process**: Users see not just "done/not done" but every intermediate step
- **Confidence through transparency**: The system surface maximum context about what agents are doing

### 1.2 Consistency with TracePilot Design System

All prototypes inherit from `design-system-c.css` — TracePilot's dark-first component library:

- **Dark foundation**: `#09090b` background, `#fafafa` text, subtle border separators
- **Indigo accent palette**: `#6366f1` primary, `#818cf8` hover states, gradient headers
- **Inter typography**: System-standard, with weight hierarchy (400/500/600/700)
- **Card-based layouts**: Consistent border-radius (10px), hover elevations, grid systems
- **Existing components reused**: stat-cards, badges, tables, progress bars, modals, tabs

Where prototypes deviate from the base design system, it's to serve task-specific needs
(e.g., DAG visualizations, Gantt charts, live event streams).

### 1.3 Progressive Disclosure

Complex information is revealed in layers:

1. **Dashboard level**: High-level stats and status indicators
2. **List/grid level**: Filterable task queues and preset collections
3. **Detail level**: Full task context, results, execution timeline
4. **Expert level**: DAG visualizations, raw logs, orchestrator internals

---

## 2. View-by-View Design Decisions

### 2.1 Task Dashboard (`/tasks`)

**File**: `task-dashboard.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Stats bar → Orchestrator card → Split (Queue + Presets) → Jobs | Top-down priority: most urgent info first |
| Orchestrator prominence | Full-width hero card with pulse animation | It's the "engine" — users need to know if it's running |
| Task queue style | Compact table with inline status badges | Density matters — users may have dozens of tasks |
| Preset display | Card grid with category pills | Presets are "templates" — visual distinction from tasks |
| Job grouping | Collapsible swimlane sections | Jobs group tasks; nesting communicates hierarchy |
| Empty states | Illustrated CTAs with action buttons | Guide new users to create their first task/preset |

**Key interaction patterns**:
- Click-through from any task row → Task Detail view
- Quick-action buttons on task rows (retry, cancel, view results)
- Orchestrator card click → Orchestrator Monitor view
- "New Task" FAB always accessible

### 2.2 Task Detail (`/tasks/:id`)

**File**: `task-detail.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Header | Status badge + title + metadata row | Identity at a glance |
| Primary content | Tabbed interface (Result / Context / Timeline / Schema / Logs) | Multiple data types need organized access |
| Result display | Structured JSON viewer with syntax highlighting | Tasks output structured data per schema |
| Timeline | Vertical stepped timeline with state transitions | Shows full lifecycle transparently |
| Context preview | Collapsible sections with file tree | Users need to verify what context was sent |
| Validation | Green/red schema compliance indicators | Immediate trust signal on result quality |

**Key interaction patterns**:
- Tab switching preserves scroll position
- Result viewer supports expand/collapse for nested objects
- "Re-run" button pre-fills Create Task with same parameters
- Share/export result as JSON or markdown

### 2.3 Task Presets (`/tasks/presets`)

**File**: `task-presets.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Organization | Tabbed: User Presets / Built-in / Community | Clear provenance distinction |
| Display mode | Toggle between card grid and compact list | User preference for density vs. detail |
| Preset cards | Icon + name + description + category pill + usage count | Essential info without opening detail |
| Search & filter | Combined search bar + category dropdown | Fast discovery in large collections |
| Quick actions | Edit, Duplicate, Test Run, View Schema | Common operations without navigation |
| Built-in presets | Read-only cards with "Duplicate to customize" CTA | Protect defaults while enabling customization |

**Key interaction patterns**:
- Click card → opens inline detail panel (split view) OR navigates to editor
- Drag-and-drop reordering within user presets
- "Import from file" and "Import from URL" options
- Category management with color-coded pills

### 2.4 Preset Editor (`/tasks/presets/:id`)

**File**: `preset-editor.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Split panel: form editor (left) + live preview (right) | Real-time feedback while editing |
| Form structure | Collapsible sections: Basic / Prompt / Context / Schema / Execution | Logical grouping reduces cognitive load |
| Prompt editor | Monaco-style editor with template variable highlighting | Power users need rich editing |
| Schema definition | Visual JSON Schema builder + raw JSON toggle | Approachable for non-experts, powerful for experts |
| Context sources | Multi-select with drag-to-reorder | Order affects token budget allocation |
| Validation | Inline real-time validation with error indicators | Prevent invalid presets before save |

**Key interaction patterns**:
- Auto-save with undo/redo history
- "Test with sample data" button to preview output
- Template variable insertion via `{{variable}}` autocomplete
- Side-by-side diff when editing built-in preset copies

### 2.5 Create Task (`/tasks/new`)

**File**: `create-task.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flow type | Multi-step wizard with progress indicator | Reduces overwhelm for complex configuration |
| Step 1 | Preset selection with search and category filter | Most tasks start from a preset |
| Step 2 | Context selection with token budget visualization | Users need to understand context costs |
| Step 3 | Parameter overrides with inline validation | Customize without modifying the preset |
| Step 4 | Review & launch with cost estimation | Confirmation before committing resources |
| Quick mode | Single-page form for "from scratch" tasks | Power users skip the wizard |

**Key interaction patterns**:
- Preset cards in step 1 show "last used" and "popularity" indicators
- Token budget bar updates in real-time as context sources are added/removed
- "Add to Job" option to group with existing tasks
- Schedule for later vs. run immediately toggle
- Estimated completion time based on historical data

### 2.6 Job Detail (`/tasks/jobs/:id`)

**File**: `job-detail.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Header | Job name + status + progress ring + task count | Job identity and completion at a glance |
| Task list | Compact table with status badges and progress bars | See all tasks in the group |
| DAG mini-view | Inline dependency graph showing task relationships | Visualize execution order |
| Timeline | Horizontal Gantt chart showing parallel execution | Understanding of actual parallelism |
| Actions | Retry failed, Cancel remaining, Add task to job | Bulk operations on task groups |
| Completion | Aggregated results summary with per-task drill-down | Job-level summary with detail access |

**Key interaction patterns**:
- Click any task row → navigates to Task Detail view
- Drag tasks in DAG to reorder dependencies
- "Retry all failed" as a prominent action button
- Export job results as a combined report

### 2.7 Task Results Viewer

**File**: `task-results.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Full-width result display with metadata sidebar | Maximum space for result content |
| Result types | JSON tree viewer, Markdown renderer, Diff viewer | Tasks produce varied output formats |
| Schema validation | Inline pass/fail indicators on each field | Trust signal for structured outputs |
| Comparison | Side-by-side result comparison for re-runs | Track improvements across iterations |
| Export | Copy, download JSON, download markdown, share link | Multiple consumption patterns |
| History | Version timeline of result iterations | Track how results evolve with re-runs |

### 2.8 Orchestrator Monitor

**File**: `orchestrator-monitor.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Aesthetic | "Mission control" with dark dramatic styling | Communicates the gravity of autonomous operation |
| Event stream | Live-scrolling terminal-style log | Real-time visibility into orchestrator actions |
| Active subagents | Card grid with per-agent progress | See all concurrent work at a glance |
| Timeline | Horizontal Gantt showing agent lifetimes | Understanding parallelism and sequencing |
| Metrics | Request count, token usage, error rate, uptime | Operational health indicators |
| Recovery | Crash detection with auto-restart status | Transparency about failure handling |

**Key interaction patterns**:
- Pause/resume event stream scrolling
- Filter events by type (info, warning, error, subagent)
- Click subagent card → linked to task detail
- Manual "Restart Orchestrator" button with confirmation

### 2.9 Orchestrator Settings (`/tasks/config`)

**File**: `orchestrator-settings.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Sectioned form with sidebar navigation | Settings categories are distinct enough to separate |
| Sections | Model / Auto-run / Pool / Retention / Recovery / Security / Costs | Comprehensive configuration surface |
| Model selection | Dropdown with capability badges (speed/quality/cost) | Informed model choice |
| Auto-run | Toggle + cron-style schedule builder | Power users need scheduling flexibility |
| Security | Permission matrix with role-based access | Enterprise requirement |
| Cost estimation | Live calculator based on current config | Budget awareness before committing |

### 2.10 Task DAG Visualization

**File**: `task-dag.html`

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary view | SVG node-link diagram with layered layout | Standard DAG visualization approach |
| Node design | Rounded cards with status colors and icons | Visual distinction per task state |
| Edge style | Curved arrows with animation for active flows | Show data/dependency direction clearly |
| Interaction | Pan, zoom, click-to-select, hover tooltips | Standard graph interaction patterns |
| Alternative views | Timeline (Gantt) and Table views | Different mental models for different users |
| Minimap | Bottom-right corner overview | Navigation aid for large graphs |

---

## 3. Cross-Cutting UX Patterns

### 3.1 Status Communication

Task states use a consistent color vocabulary across all views:

| State | Color | Badge Style |
|-------|-------|-------------|
| Pending | `#a1a1aa` (zinc) | Outline, subtle |
| Claimed | `#60a5fa` (blue) | Filled, medium |
| In Progress | `#6366f1` (indigo) | Filled, pulse animation |
| Done | `#34d399` (emerald) | Filled, checkmark icon |
| Failed | `#f87171` (red) | Filled, X icon |
| Cancelled | `#fbbf24` (amber) | Outline, strike-through |
| Expired | `#a78bfa` (violet) | Outline, clock icon |
| Dead Letter | `#ef4444` (red-dark) | Filled, skull icon |

### 3.2 Navigation Model

```
/tasks                    → Task Dashboard (home)
/tasks/:id                → Task Detail
/tasks/:id/results        → Task Results Viewer
/tasks/new                → Create Task (wizard)
/tasks/presets             → Presets Management
/tasks/presets/:id         → Preset Editor
/tasks/presets/new         → Preset Editor (create mode)
/tasks/jobs/:id            → Job Detail
/tasks/config              → Orchestrator Settings
/tasks/monitor             → Orchestrator Monitor
/tasks/dag                 → Task DAG (global)
/tasks/dag?job=:id         → Task DAG (job-scoped)
```

### 3.3 Responsive Behavior

- **Desktop (≥1200px)**: Full sidebar + multi-column layouts
- **Tablet (768–1199px)**: Collapsed sidebar, single-column with stacked panels
- **Mobile (≤767px)**: Bottom navigation, card-only layouts (tables → cards)

All prototypes include responsive breakpoints, though desktop is the primary target.

### 3.4 Empty States

Every view has a designed empty state with:
- Contextual illustration or icon
- Explanatory text ("No tasks yet")
- Primary action button ("Create your first task")
- Optional link to documentation

### 3.5 Loading States

- **Skeleton screens** for initial page loads (not spinners)
- **Progress bars** for long-running operations with estimated completion
- **Optimistic updates** for user actions (badge changes instantly, syncs in background)

### 3.6 Error Handling UX

- **Inline validation**: Real-time feedback on form fields
- **Toast notifications**: For background operations (task completed, orchestrator restarted)
- **Error banners**: For critical issues (orchestrator crashed, database error)
- **Retry affordances**: Every failed state has a visible retry action

---

## 4. Accessibility Considerations

- All interactive elements are keyboard-navigable
- ARIA labels on icon-only buttons
- Color is never the sole indicator of state (icons accompany colors)
- Focus management on modal open/close
- Reduced motion media query support for animations
- Sufficient color contrast ratios (WCAG AA minimum)

---

## 5. Theme Support

All prototypes support dark and light themes via:
- CSS custom properties (color tokens)
- `prefers-color-scheme` media query for system preference
- Manual toggle button in page header
- Theme preference persisted to localStorage

The dark theme is primary (matches TracePilot's current aesthetic).
The light theme is a complementary alternative for accessibility and preference.

---

## 6. Implementation Notes

### 6.1 Mapping to Vue Components

Each prototype maps to one or more Vue single-file components:

| Prototype | Vue Route | Primary Component | Key Child Components |
|-----------|-----------|-------------------|---------------------|
| task-dashboard | `/tasks` | `TaskDashboardView.vue` | `OrchestratorCard`, `TaskQueueTable`, `PresetGrid`, `JobSwimlane` |
| task-detail | `/tasks/:id` | `TaskDetailView.vue` | `TaskResultViewer`, `ExecutionTimeline`, `ContextPreview`, `SchemaValidator` |
| task-presets | `/tasks/presets` | `TaskPresetsView.vue` | `PresetCard`, `PresetCategoryFilter`, `PresetDetailPanel` |
| preset-editor | `/tasks/presets/:id` | `TaskPresetEditorView.vue` | `PromptEditor`, `SchemaBuilder`, `ContextSourceSelector`, `PresetPreview` |
| create-task | `/tasks/new` | `CreateTaskView.vue` | `PresetSelector`, `ContextConfigurator`, `TaskReviewPanel`, `TokenBudget` |
| job-detail | `/tasks/jobs/:id` | `JobDetailView.vue` | `JobTaskTable`, `JobDagMini`, `JobGanttChart`, `JobResultsSummary` |
| task-results | `/tasks/:id/results` | `TaskResultsView.vue` | `JsonTreeViewer`, `MarkdownRenderer`, `ResultComparison`, `SchemaValidation` |
| orchestrator-monitor | `/tasks/monitor` | `OrchestratorMonitorView.vue` | `EventStream`, `SubagentGrid`, `GanttTimeline`, `MetricsPanel` |
| orchestrator-settings | `/tasks/config` | `OrchestratorConfigView.vue` | `ModelSelector`, `AutoRunConfig`, `SecurityMatrix`, `CostEstimator` |
| task-dag | `/tasks/dag` | `TaskDagView.vue` | `DagCanvas`, `DagMinimap`, `DagNodeDetail`, `DagControls` |

### 6.2 State Management

Each view connects to Pinia stores following TracePilot's existing patterns:

- **`useTaskStore`**: Task CRUD, queue management, status transitions
- **`usePresetStore`**: Preset CRUD, category management, built-in registry
- **`useJobStore`**: Job grouping, DAG management, batch operations
- **`useOrchestratorStore`**: Orchestrator lifecycle, event stream, health monitoring
- **`useTaskConfigStore`**: Model selection, auto-run settings, security config

### 6.3 Backend Integration Points

| Frontend Action | IPC Command | Backend Module |
|----------------|-------------|----------------|
| Load task queue | `task_list` | `tracepilot-orchestrator` |
| Create task | `task_create` | `tracepilot-orchestrator` |
| Update task status | `task_update_status` | `tracepilot-orchestrator` |
| Load presets | `preset_list` | `tracepilot-orchestrator` |
| Save preset | `preset_save` | `tracepilot-orchestrator` |
| Start orchestrator | `orchestrator_start` | `tracepilot-tauri-bindings` |
| Stop orchestrator | `orchestrator_stop` | `tracepilot-tauri-bindings` |
| Get orchestrator status | `orchestrator_status` | `tracepilot-tauri-bindings` |
| Load task results | `task_result_get` | `tracepilot-orchestrator` |
| Load DAG | `job_dag_get` | `tracepilot-orchestrator` |

---

## 7. Prototype Index

| # | Prototype | File | Description | Size |
|---|-----------|------|-------------|------|
| 1 | Task Dashboard | `task-dashboard.html` | Main command center with stats, queue, presets, jobs | ~83KB |
| 2 | Task Detail | `task-detail.html` | Full task lifecycle view with tabbed content | ~90KB |
| 3 | Task Presets | `task-presets.html` | Preset collection with grid/list toggle and categories | ~120KB |
| 4 | Preset Editor | `preset-editor.html` | Split-panel editor with live preview | ~62KB |
| 5 | Create Task | `create-task.html` | Multi-step wizard for task creation | ~95KB |
| 6 | Job Detail | `job-detail.html` | Job grouping with DAG mini-view and Gantt | ~92KB |
| 7 | Task Results | `task-results.html` | Structured result viewer with schema validation | ~73KB |
| 8 | Orchestrator Monitor | `orchestrator-monitor.html` | Real-time mission control with event stream | ~86KB |
| 9 | Orchestrator Settings | `orchestrator-settings.html` | Configuration page with 8 setting sections | ~91KB |
| 10 | Task DAG | `task-dag.html` | SVG dependency graph with multiple view modes | ~78KB |

---

**Total: ~905KB of interactive prototypes across 10 views.**
