# Visual regression tests

The production Vue router is the route source of truth. `routes.json` is generated with
`pnpm routes:generate` and guarded by `pnpm routes:check`.

`pnpm visual:capture` starts the real Vite application and injects deterministic Tauri
IPC responses before application code executes. It fails when a route renders a fallback,
lacks its stable route identity, emits browser errors, or has serious/critical automated
accessibility violations. It never substitutes screenshots from `docs/images`.

The pull-request workflow captures both the merge-base and candidate revisions with the
same browser, viewport, timezone, locale, reduced-motion setting, and mock profile. Changed
paths select affected route components; shell, router, design-token, shared UI, CSS, and
Rust-backend changes conservatively select all routes.
