# @tracepilot/desktop

The TracePilot desktop application: a Tauri 2 shell wrapping a Vue 3 single-
page app. This directory contains the **frontend** (Vue / Vite); the Rust
shell and Tauri commands live in [`src-tauri/`](./src-tauri/README.md) and the
crates under [`../../crates/`](../../crates/).

Architecture reference: ADR [0001 — Tauri + Vue + Rust workspace](../../docs/adr/0001-tauri-vue-rust-workspace.md).

## Scripts

```bash
pnpm --filter @tracepilot/desktop dev          # Vite dev server (frontend only)
pnpm --filter @tracepilot/desktop tauri dev    # Full Tauri dev build
pnpm --filter @tracepilot/desktop build        # type-check + production Vite build
pnpm --filter @tracepilot/desktop test         # vitest (unit + component)
pnpm --filter @tracepilot/desktop typecheck    # vue-tsc --noEmit
pnpm --filter @tracepilot/desktop analyze      # bundle visualizer
```

## Workspace dependencies

- `@tracepilot/client` — typed IPC wrappers (used by every store and view).
- `@tracepilot/types` — shared DTO types.
- `@tracepilot/ui` — design tokens + Vue component library.
- `@tracepilot/test-utils` (dev) — Pinia setup + fixture builders.

## Frontend layout

- `src/main.ts` — app entrypoint; installs Pinia, router, and `@tracepilot/ui/tokens.css`.
- `src/router/` — vue-router routes and guards.
- `src/views/` — route-level pages (sessions list, detail, analytics, settings…).
- `src/components/` — reusable Vue components (not route-level).
- `src/stores/` — Pinia stores; one per domain. Conventions in ADR
  [0006 — Frontend state via Pinia + run helpers](../../docs/adr/0006-frontend-state-pinia-run-helpers.md).
- `src/composables/` — framework-agnostic composition functions.
- `src/lib/` — plain TS helpers with no Vue dependency.
- `src/config/` — app-level config (feature flags, constants).
- `src/styles/` — app-owned CSS; `@tracepilot/ui/tokens.css` is imported here.
- `src/utils/` — small utilities (formatting, error mapping).
- `src/__tests__/` — Vitest suites (components + stores).
- `src-tauri/` — Rust side: Tauri config, capabilities, entrypoint. See
  [`src-tauri/README.md`](./src-tauri/README.md).

## IPC

The frontend never calls `@tauri-apps/api`'s `invoke` directly — all IPC goes
through `@tracepilot/client`, which enforces the specta-generated contract
described in ADR [0002](../../docs/adr/0002-ipc-contract-specta-bindings.md).
Capability scoping is covered in ADR [0011](../../docs/adr/0011-tauri-capability-scoping.md).

## Error handling

Rust errors arrive as structured `BindingsErrorIpc` values (see ADR
[0005 — Error model: `thiserror` per crate + IPC envelope](../../docs/adr/0005-error-model-thiserror-per-crate.md)).
`src/utils/errorHandler.ts` converts those to user-facing messages.
