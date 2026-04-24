# ADR-0007 — Copilot SDK always compiled in, gated at runtime by user preference

- **Date:** 2026-04-18
- **Status:** Accepted
- **Supersedes:** Portions of ADR-0001 that described `copilot-sdk` as an
  optional Cargo feature.

## Context

The Copilot SDK bridge (community
[`copilot-sdk`](https://github.com/copilot-community-sdk/copilot-sdk-rust)
dependency + TracePilot `BridgeManager`) was originally exposed through a
Cargo feature chain:

```
tracepilot-desktop/copilot-sdk
  → tracepilot-tauri-bindings/copilot-sdk
    → tracepilot-orchestrator/copilot-sdk
      → copilot-sdk crate (git dep)
```

With `--no-default-features`, every bridge method returned
`BridgeError::NotAvailable` so the binary stayed shippable. Separately, a
frontend-only experimental toggle (`FeaturesConfig.copilot_sdk`) hid the SDK
UI surface in the desktop app.

Two problems emerged:

1. **The runtime toggle was non-load-bearing.** The backend never read
   `FeaturesConfig.copilot_sdk`. If any code path (auto-connect, a deep
   link, a future IPC consumer) bypassed the UI gate, the bridge happily
   spawned the CLI subprocess, ignoring the user's preference.
2. **The Cargo feature added maintenance cost for no observed benefit.**
   Every new submodule in `crates/tracepilot-orchestrator/src/bridge/`
   had to be peppered with `#[cfg(feature = "copilot-sdk")]` and shadowed
   by stub functions. No shipping configuration, CI job, or supported
   build path actually exercised the disabled branch, so the stubs were
   dead weight — and a silent drift risk (e.g. a new method added on the
   enabled side but forgotten on the stub side would still compile
   cleanly in the default profile).

## Decision

1. **Compile the Copilot SDK into every build.** Remove the `copilot-sdk`
   Cargo feature from `tracepilot-orchestrator`, `tracepilot-tauri-bindings`
   and `apps/desktop/src-tauri`. Make the `copilot-sdk` dep non-optional in
   the orchestrator manifest. Strip all `#[cfg(feature = "copilot-sdk")]`
   and `#[cfg(not(feature = "copilot-sdk"))]` gates and the stub method
   bodies they guarded.
2. **Make `FeaturesConfig.copilot_sdk` load-bearing at runtime.** Introduce
   `BridgeError::DisabledByPreference` and gate the bridge **start paths**
   — `connect`, `create_session`, and the fresh (non-cached) branch of
   `resume_session` — with a preference check. Leave steering calls on
   already-tracked sessions (`send_message`, `abort_session`,
   `set_session_mode/model`, `destroy_session`, `unlink_session`,
   read-only queries) ungated so a user who toggles the preference off
   mid-flight doesn't lose work in progress.
3. **Decouple the orchestrator from Tauri state.** The orchestrator exposes
   a `CopilotSdkEnabledReader = Arc<dyn Fn() -> bool + Send + Sync>` type
   alias and a `BridgeManager::set_preference_reader` setter. The Tauri
   bindings crate builds the closure from `SharedConfig` during plugin
   setup and installs it on the shared manager. Default (no reader
   installed) behaviour is "enabled", preserving existing unit-test
   ergonomics.
4. **Surface the runtime state on the wire.** Add
   `BridgeStatus.enabledByPreference: bool` so the frontend has an
   authoritative signal from the backend instead of re-reading the pref
   independently. Retain `sdkAvailable` as a now-always-`true` field for
   wire-format stability. Retain `BridgeError::NotAvailable` similarly —
   the frontend still pattern-matches on it in older builds.

## Consequences

**Good.**

- The user preference is now enforced at the only layer that matters
  (the bridge) rather than trusted to the UI. Any future IPC consumer
  automatically inherits the guard.
- The bridge source tree is significantly smaller and easier to reason
  about: no cfg-shadowed stubs, no drift between stub and real
  signatures, no per-submodule attribute noise.
- CI runs a single configuration. We no longer paper over the cost of
  a disabled-path that nobody actually ships.
- Existing sessions survive a toggle-off — important for trust: flipping
  the experimental switch can't destroy in-flight work.

**Trade-offs.**

- Every TracePilot binary now links the `copilot-sdk` git dependency
  unconditionally. This is a build-time coupling, not a runtime one (the
  CLI subprocess is only spawned when the user opts in via the pref),
  but it does mean the workspace cannot compile on hosts that can't
  reach the upstream git dep. This is already implicitly required for
  default builds; ADR-0007 simply makes it explicit.
- `BridgeError::NotAvailable` becomes a dead code path in production,
  retained only for wire compatibility. Future cleanup (after we're
  confident no older frontend still matches on it) can remove it.

## Alternatives considered

1. **Keep the Cargo feature, add the runtime guard on top.** Rejected:
   adds the runtime-guard maintenance burden without removing the
   cfg-gated stub maintenance burden. The dual gating is also confusing
   — readers must ask "which layer turned this off?" for every bug
   report.
2. **Remove the runtime preference entirely; expose the SDK
   unconditionally when compiled in.** Rejected: the SDK is an
   experimental surface and we want users to opt in. Removing the pref
   would also silently re-enable the SDK for every user on upgrade.
3. **Replace the stub branch with a separate `copilot-sdk-stub`
   crate.** Rejected: does not remove the complexity, only relocates
   it; still no CI that exercises the disabled config.

## References

- `crates/tracepilot-orchestrator/src/bridge/mod.rs` —
  `BridgeError::DisabledByPreference`, `BridgeStatus.enabled_by_preference`,
  `CopilotSdkEnabledReader`.
- `crates/tracepilot-orchestrator/src/bridge/manager/mod.rs` —
  `BridgeManager::set_preference_reader`,
  `BridgeManager::is_enabled_by_preference`.
- `crates/tracepilot-tauri-bindings/src/lib.rs` — reader wiring during
  plugin setup.
- `packages/types/src/sdk.ts` — `BridgeStatus.enabledByPreference`
  mirror.
- `docs/copilot-sdk-usage.md` — user-facing documentation of the runtime
  guard.
