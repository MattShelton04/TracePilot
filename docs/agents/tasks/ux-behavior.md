# Interaction and state UX

Fix one concrete way the UI misleads, traps or frustrates a user.

**Presets** (all focused):
- `states`: loading, empty and error states.
- `keyboard`: keyboard and focus.
- `form`: one settings or input flow.
- `collection`: search, filters, sorting or tables.

**Protocol:** read [protocol.md](../protocol.md) sections Core, UI, Running the app, and Ship. If backend validation or persistence changes, also read Rust and IPC.
<!-- protocol: core ui app rust? ship -->

## Launch

```text
Read docs/agents/tasks/ux-behavior.md and follow it. Preset: states. Focus: Search while the index is still building.
```

## Rules for every preset

- Reproduce the problem by driving the store or component with controlled promises, by using mocks (`pnpm app:ui`, or `scripts/visual/fixtures.mjs` when a state can't be reached otherwise), or natively on synthetic data.
- Fix it with the existing components (`EmptyState`, `ErrorState`, `ErrorAlert`, `LoadingSpinner`, `ModalDialog`, `ConfirmDialog`, `Drawer`, `DataTable`, `FilterSelect`) and the existing data model.
- Add a behavior test for the transition that went wrong, and capture visual evidence of the fixed state.
- Don't redesign the screen, add a form, table or virtualization library, invent shortcuts, or show fake progress.

## Presets

### `states`
Candidate surfaces:
- Search: index building, versus no sessions, versus no results, versus everything filtered out, versus an error.
- The analytics pages when the time range has no data.
- Session tabs on sessions that lack data, such as old CLI versions or running sessions.
- The Explorer with unreadable or oversized files.
- Agents and Skills when a dependency is missing.

Keep existing data visible while refreshing. Offer a next action only when it is valid. Prevent spinners that never stop and messages that contradict each other.

### `keyboard`
Candidates:
- modal focus trap and focus return (covered by `packages/ui/src/__tests__/OverlayFocus.test.ts`);
- arrow-key behavior on tab strips and `SegmentedControl`;
- tool-call disclosures;
- the sidebar;
- tooltips that only work on hover;
- row actions;
- icon buttons with no accessible name.

Walk through the interaction with the keyboard only (Tab, Shift+Tab, Enter, Escape, arrows), taking a fresh snapshot each step. Prefer native elements to ARIA. Test the whole journey, including where focus ends up, with `@vue/test-utils` keyboard events. Don't claim WCAG compliance or screen-reader testing you didn't do.

### `form`
Candidates: Settings sections, the setup wizard, the Session Launcher, the Agent and Skill editors, and export options. **Trace the real persistence destination for your flow before editing.** It can be TracePilot's `config.toml`, Copilot's `settings.json` or `config.json`, or agent and skill files. Every native save, reset or restore runs only against an isolated `-DataRoot`. Exercise a valid save, an invalid input, and failure followed by retry. Never rely only on frontend validation where the backend should validate, never clear the user's input on failure, and never make the business rules stricter on your own initiative.

### `collection`
Candidates: the session list's filters and sort, the Search view, Events tab filters and paging, the analytics tables, and the Worktree Manager. Problems to look for:
- a page index that is invalid after filtering;
- counts that don't say whether they're filtered or paged;
- unstable sorting when values tie;
- a selection that goes stale after a refresh;
- a "clear filters" that misses some filters.

**Don't silently change how search queries are interpreted.** That belongs in the Rust indexer, with tests.

## Done when

One reproduced interaction problem is fixed and covered by a behavior test plus visual evidence. The PR says whether native persistence or backend behavior was verified.
