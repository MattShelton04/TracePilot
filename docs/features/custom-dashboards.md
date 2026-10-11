# Custom Analytics dashboards

Status: proposed, not started. The redesigned Analytics dashboard is a fixed
layout with a few remembered view switches. This note records what letting
people arrange their own dashboards would take, so the work can start from
here rather than from scratch.

## What exists today

- `AnalyticsDashboardView.vue` places the panels in a fixed order: KPIs,
  Activity, model mix and token kinds, Cost, model time and pace, incidents and
  cache, agents and skills. Pairs sit side by side above an 880px container
  width.
- Every panel is a self-contained component in `components/analytics/`. Each
  takes the dashboard payload (or a slice of it) as props, or loads its own data
  (Agents, Skills), and handles its own loading, empty and error states.
- `useAnalyticsDashboardViews` persists view choices (activity metric and
  style, cost view, incident view and scale) in one validated `localStorage`
  entry, `tracepilot-analytics-dashboard-views`.

Because panels are already independent, a custom layout is mostly a question
of placement and persistence, not of refactoring the panels.

## What a custom dashboard would add

1. **A panel registry.** A typed list of `{ id, title, component, props(data,
   summary), minSpan, defaultSpan }` entries, so the layout refers to panels by
   id. The fixed layout becomes the default entry list.
2. **A layout model.** An ordered list of `{ panelId, span: 1 | 2 }` rows on a
   two-column grid. Spans, not pixel sizes: the dashboard must still collapse to
   one column at narrow widths (960×640 is the minimum supported viewport).
3. **Persistence and migration.** Store the layout next to the view choices,
   versioned, validated on read the way `readAnalyticsViews` is, dropping
   unknown panel ids and falling back to the default. Consider moving it to
   `config.toml` if layouts should follow the user across machines.
4. **An edit mode.** A toggle in the page header that shows drag handles,
   span switches and an "Add panel" list of hidden panels, with "Reset to
   default". Keyboard reordering (move up and down) is required, not optional.
5. **Several dashboards (later).** Named layouts, for example "Cost review" or
   "Agent health", picked from the page header.

## Open questions

- Should a panel be allowed twice with different settings, such as two
  Activity charts, one for cost and one for runs? That turns view choices into
  per-instance settings.
- Do the Tools, Code and Models pages join the same registry, so one dashboard
  can mix their panels? Their data comes from separate commands, so each panel
  would need to load on its own, as Agents and Skills already do.
- Is drag-and-drop worth a dependency, or is a simple move up/down and span
  editor enough?

## Risks

- Layout freedom can break the alignment the fixed layout guarantees, such as
  Agents and Skills tiles lining up side by side. A one- or two-column grid
  with spans keeps most of it.
- Every panel would need to look right at both spans, which means a visual
  check of each at 1440×960, 960×640 and 2560×1440.
