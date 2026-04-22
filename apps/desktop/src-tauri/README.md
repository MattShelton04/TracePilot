# tracepilot-desktop

Binary crate for the TracePilot desktop application. This is a thin Tauri 2
entrypoint: it wires logging, applies shared config, registers the
`tracepilot-tauri-bindings` plugin (which provides every IPC command), and
loads the Vue frontend from [`../src/`](../src/).

## Responsibilities

- Initialise logging (`tauri-plugin-log`) using the level from shared config.
- Register Tauri plugins: dialog, log, notification, opener, process, updater.
- Install `tracepilot_tauri_bindings::init()` — the plugin that contributes all
  IPC commands, event forwarders, and managed state (bridge manager, caches,
  task DB, orchestrator state).
- Gate the optional `copilot-sdk` feature (forwarded to the bindings crate)
  and the `tokio-console` feature (async task debugging).

This crate deliberately contains **no IPC handler logic** — handlers live in
`crates/tracepilot-tauri-bindings`. See ADR
[0002 — IPC contract via specta-generated bindings](../../../docs/adr/0002-ipc-contract-specta-bindings.md).

## Cargo features

| Feature         | Default | Purpose                                                         |
| --------------- | ------- | --------------------------------------------------------------- |
| `copilot-sdk`   | on      | Forwards to `tracepilot-tauri-bindings/copilot-sdk`             |
| `tokio-console` | off     | Replaces log bridge with `console-subscriber` for async tracing |

`--no-default-features` produces a shippable binary whose SDK bridge commands
return `BridgeError::NotAvailable`.

## Layout

- `Cargo.toml` — crate manifest + feature flags.
- `tauri.conf.json` — window, security (CSP), bundle config. See ADR
  [0011 — Tauri capability scoping](../../../docs/adr/0011-tauri-capability-scoping.md).
- `capabilities/` — per-window capability JSON.
- `src/main.rs` — `fn main()`; builds the Tauri app and runs it.
- `build.rs` — invokes `tauri_build::build()` to generate the Tauri context.
- `icons/` — app icons.

## Related crates

- [`tracepilot-tauri-bindings`](../../../crates/tracepilot-tauri-bindings/README.md) — the IPC command surface.
- [`tracepilot-core`](../../../crates/tracepilot-core/README.md) — domain logic.
- [`tracepilot-indexer`](../../../crates/tracepilot-indexer/README.md) — search index.

## Build

```bash
pnpm --filter @tracepilot/desktop tauri dev            # dev
pnpm --filter @tracepilot/desktop tauri build          # release bundle
cargo build -p tracepilot-desktop --no-default-features
```

## Supported platforms

See ADR [0010 — Supported platforms](../../../docs/adr/0010-supported-platforms.md).
