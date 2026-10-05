# Maintainability

Make code easier to understand and change without changing its behavior.

**Presets:**
- `function` (focused, the default): simplify one function.
- `duplicated-rule` (focused): give a duplicated rule a single source of truth.
- `hotspot` (larger): restructure one module or component family.
- `dead-code` (larger, situational): remove material that is provably unused.

**Protocol:** read [protocol.md](../protocol.md) sections Core, Rust and IPC, and Ship. If your target is frontend code, also read UI and Running the app.
<!-- protocol: core rust ui? app? ship -->

## Launch

```text
Read docs/agents/tasks/maintainability.md and follow it. Preset: hotspot. Focus: apps/desktop/src/views/tabs/ExplorerTab.vue
```

## Rules for every preset

- Pick by **structure and churn, not length**. Good signs:
  - nesting deeper than about three levels;
  - flag parameters that change behavior;
  - mutable state threaded through a long body;
  - parsing mixed with accounting, or IO mixed with formatting;
  - comments that only explain confusing flow.

  Check that the area actually changes often (`git log --stat`).
- If the behavior you touch isn't covered, write characterization tests first.
- Preserve:
  - return values and error variants and messages;
  - the order of side effects;
  - **iteration and sort order**, which feeds UI ordering;
  - public APIs and IPC shapes;
  - hot-path cost in parsing and indexing. If you touch them, compare a Criterion bench from `crates/tracepilot-bench/benches/`, run with `pwsh -File scripts/bench.ps1`.
- In the PR, describe the old shape and the new shape in two or three sentences, and name the maintenance burden you removed.
- Don't introduce a new architecture or a generic framework, do repo-wide renames, or split files mechanically just to meet a budget.

## Presets

### `function`
Find candidates in:
- `crates/tracepilot-core/src/{parsing,turns,agent_runs,analytics,summary}`;
- `crates/tracepilot-indexer/src/index_db/`;
- the stores and composables under `apps/desktop/src`.

Useful moves are early returns, well-named intermediate values, separating pure logic from effects, and replacing a flag parameter with two clear paths. Add a helper only if it has a real responsibility.

### `duplicated-rule`
These rules tend to be duplicated:
- in Rust (core and indexer) and TypeScript (desktop and `packages/ui`): status classification, tool-name normalization, accounting, durations, and path display;
- between indexed analytics (`crates/tracepilot-indexer/src/index_db/analytics_queries`) and live reconstruction (`crates/tracepilot-core`).

Show that the copies can disagree. If a difference between them is intentional, leave it and explain why. Use the simplest shared home, and respect package direction (`packages/types` is depended on by everything else). Don't invent cross-language code generation. Add a table-driven test for the shared rule.

### `hotspot`
Files at or near their size budget are a strong signal, because the next feature will break the budget. Re-measure line counts before choosing. Larger Vue tab and chart components and Rust files at exactly 500 lines are typical. Useful moves:
- extract child components or composables with clear props;
- split a Rust module by responsibility, keeping `pub use` paths stable;
- clarify who owns which state.

For UI refactors, before and after screenshots must look identical.

### `dead-code`
Use this only when there is a trigger, such as a finished migration or a removed feature. Prove each item is unused by checking:
- imports and string or dynamic references;
- `package.json` and `justfile` scripts;
- workflows;
- registries (renderers, the visual manifest, `ipc-commands.json`);
- Tauri capabilities;
- public exports;
- `git log -S`.

A missing text match is not proof. Don't remove historical docs, ADRs, plans or dated reports, which are kept on purpose. Also leave alone the "audit-only helpers" listed in `scripts/README.md`, macOS code and migrations. Put the evidence for each deletion in the PR body.

## Done when

Behavior is identical and pinned by tests, a reader can follow the code more easily (or less dead material remains), and the PR explains why.
