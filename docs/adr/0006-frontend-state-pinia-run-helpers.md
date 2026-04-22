# ADR-0006: Frontend state — Pinia stores with `runAction`/`runMutation`, no direct mutations

Date: 2026-04-22
Status: Accepted

## Context

TracePilot's UI state is substantial: sessions, tasks, orchestrator
jobs, skills, MCP servers, worktrees, launcher presets, SDK
connection state, search indexing progress. Every store has the same
lifecycle concerns:

- A loading flag (single-flight vs overlapping refreshes).
- A last-error slot so the UI can show a toast or inline error.
- Consistent error normalisation (`toErrorMessage`) so a thrown
  `BindingsErrorIpc` becomes something humans can read.
- A `useAsyncGuard` pattern to avoid stale responses overwriting the
  store after a newer request has landed.

Before Wave 95, every Pinia store reimplemented this by hand. Bugs
recurred: forgetting to clear `loading`, forgetting to handle errors,
mutating refs inside a `try` block whose `catch` branch left state
half-updated. Worse, some components called commands directly and
mutated the store from outside, bypassing whatever discipline the
store author had in mind.

## Decision

1. **All frontend state lives in Pinia stores** under
   `apps/desktop/src/stores/`. Components never hold IPC state in
   `ref`s that outlive the component — that's what a store is for.
2. **Every async store operation uses `runAction` or `runMutation`**
   from `@tracepilot/ui`:
   - `runAction({ loading, error, ... }, fn)` — for reads. Manages a
     loading ref, captures errors into an error ref, integrates with
     `useAsyncGuard` so only the freshest caller wins.
   - `runMutation(error, fn)` — for writes. Returns the fn's value or
     `null` on error; UI code treats `null` as "show the error".
3. **No direct mutation of store state from outside the store.** The
   Wave 95 sweep made every cross-store write go through an action.
   The reviewer rule: if a `.value = ` of a ref in a store appears in
   a component, it's a bug.
4. **`useAsyncGuard` for overlapping requests.** Every action that
   hits IPC in response to user input (e.g. typing in a filter) uses
   the guard so a slow previous response cannot clobber a newer one.
5. **IPC calls go through `@tracepilot/client`.** Stores never
   `invoke(...)` directly — they call typed wrappers (`taskCreate`,
   `listSessions`, etc.) so the IPC contract (ADR-0002) stays
   enforced.
6. **Errors surface as strings via `toErrorMessage`.** The UI never
   renders a raw error object; it goes through the same helper so
   formatting stays consistent.

## Consequences

- **Positive**: Every store's public surface is a set of actions +
  reactive getters. Adding a new feature is mechanical: define the
  refs, wrap each async fn in `runAction`/`runMutation`, export.
- **Positive**: The file-size gate is satisfiable for most stores;
  the common lifecycle boilerplate moved into helpers.
- **Positive**: Tests can mock the client layer and exercise actions
  without instantiating the component tree.
- **Negative**: Contributors must learn the `runAction` /
  `runMutation` / `useAsyncGuard` trio. Mitigated by the consistency
  of existing stores — `stores/tasks.ts` is the canonical reference.
- **Negative**: `runAction`'s options object is a little verbose for
  simple cases. Worth the uniformity.

## Alternatives considered

- **Vuex 4**. Rejected — Pinia is the officially recommended Vue 3
  store. Vuex's mutation/action split was never a good fit for
  Composition API idioms.
- **Ad-hoc composables (`useX`) instead of stores**. Rejected —
  composables are per-consumer; we need shared, singleton state for
  sessions/tasks/orchestrator.
- **Component-owned state + prop drilling**. Rejected at scale — the
  session viewer alone spans many components that need the same
  derived data.
- **No helpers; continue hand-rolling lifecycle in every store.**
  Rejected — the Wave 95 audit found eight distinct bug-classes
  across stores that the helpers make impossible.

## Consequences for reviewers

- A new async store fn without `runAction` or `runMutation` is a
  red flag.
- A component that writes to a store's ref directly is a bug.
- A component that calls `invoke(...)` directly is a bug — it
  should go through `@tracepilot/client`.

## References

- `apps/desktop/src/stores/tasks.ts` — canonical reference (uses
  `runAction`, `runMutation`, `useAsyncGuard`, `toErrorMessage`).
- Other stores adopting the pattern (Wave 95 sweep):
  `mcp.ts`, `launcher.ts`, `configInjector.ts`, `worktrees.ts`,
  `skills.ts`, `sessions.ts`, `orchestrator.ts`, `sdk/connection.ts`,
  `presets.ts`, `sdk/messaging.ts`, `search/indexing.ts`.
- `packages/ui/` — `runAction`, `runMutation`, `useAsyncGuard`,
  `toErrorMessage` implementations.
- `packages/client/` — typed IPC wrappers used from stores.
- ADR-0002 — IPC contract.
- `docs/store-refactoring-plan.md` — Wave 95 background.
