# Error paths and contracts

Make one failure understandable, or replace one unsafe assumption between layers with a checked contract.

**Presets** (both focused):
- `error-path`: one failure is lost, misleading or unrecoverable.
- `ipc-contract`: Rust and TypeScript shapes, casts or mocks disagree.

**Protocol:** read [protocol.md](../protocol.md) sections Core, Rust and IPC, and Ship. If the change is visible in the UI, also read UI.
<!-- protocol: core rust ui? ship -->

## Launch

```text
Read docs/agents/tasks/robustness.md and follow it. Preset: error-path. Focus: a corrupt or locked index database.
```

## `error-path`

Errors travel this path:
1. The crate's `thiserror` enum.
2. Serialization in `crates/tracepilot-tauri-bindings/src/error*`.
3. `packages/client/src/invoke.ts` normalization.
4. The store's error slot (`toErrorMessage`).
5. A toast, `ErrorAlert` or `ErrorState`.

Candidate failures:
- an unreadable session file;
- a corrupt or locked index;
- invalid config;
- a missing Copilot CLI, `gh` or git;
- an export or import failure;
- an MCP probe timing out;
- the launcher failing;
- the SDK bridge disconnecting.

1. Trace one failure from where it starts to what the user sees.
2. Keep the cause and enough context to act on. Keep tokens out of messages.
3. Treat cancellation and "disabled by preference" as distinct from failure where the contract says so (ADR 0009).
4. Offer a recovery action only if it is safe.
5. Inject the failure in a test: a Rust test with a temporary directory and a bad file, or a store test with a mock that rejects. Assert that it propagates, the message, that no loading state is stuck, and that the normal path still works.

Don't add blanket catches, fake defaults, unbounded retries, stack traces shown to users, new telemetry, or changes to error shapes that the frontend matches on.

## `ipc-contract`

Contracts flow from Specta-generated `packages/client/src/generated/` and `packages/types/src/generated/` files to hand-written wrappers in `packages/client/src`, models in `packages/types/src`, and mocks in `packages/client/src/mock`. Event payload types live in `packages/types/src/{known-events,session-event-payloads}.ts`.

Look for:
- hand-written interfaces that have drifted from the generated ones;
- `as` or `any` on `invoke` results;
- hand-mirrored enums;
- `Option` versus required-field mismatches;
- `switch` statements that assume the set of events is complete;
- mocks that pass tests the real backend would fail.

1. Show one place where the mismatch hides or causes a bug.
2. **Fix it where it's wrong:**
   - If the TypeScript mirror, wrapper or mock is wrong, fix that and import the generated type.
   - Change Rust and run `pnpm gen:bindings` **only** if the wire contract itself is wrong.
3. Keep `config.toml`, the index, `.tpx.json` exports and older session formats compatible.
4. Test valid, missing and invalid values, at runtime as well as at compile time.

## Done when

One failure is easier to understand or recover from, or one boundary has a clearer checked contract, and a test pins it.
