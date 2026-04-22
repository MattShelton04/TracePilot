# @tracepilot/test-utils

Shared Vitest helpers for TracePilot TypeScript packages: conversation/turn
builders, a Pinia bootstrap helper, and a promise-deferred primitive. Imported
from `devDependencies` only; never ship to production bundles.

## Public API

All exports are surfaced from `src/index.ts`:

| Export                              | From            | Purpose                                                  |
| ----------------------------------- | --------------- | -------------------------------------------------------- |
| `makeTurn(overrides?)`              | `builders.ts`   | Build a `ConversationTurn` fixture                       |
| `makeTurnToolCall(overrides?)`      | `builders.ts`   | Build a `TurnToolCall` fixture                           |
| `makeAttributedMessage(overrides?)` | `builders.ts`   | Build an `AttributedMessage` fixture                     |
| `setupPinia()`                      | `pinia.ts`      | Activate a fresh Pinia instance (call in `beforeEach`)   |
| `createDeferred<T>()` / `Deferred`  | `deferred.ts`   | Promise with external `resolve` / `reject` handles       |

Each builder accepts `Partial<T>` overrides and fills in deterministic
defaults, so a single line suffices for most tests:

```ts
import { makeTurn, setupPinia } from "@tracepilot/test-utils";

beforeEach(() => setupPinia());

it("renders a turn", () => {
  const turn = makeTurn({ index: 3, status: "complete" });
  // …
});
```

## Workspace dependencies

- `@tracepilot/types` — the builders return these types.

Peer dependencies (provided by the consumer so tests share the same Vue /
Pinia singletons as the app under test):

- `vue` ^3.5
- `pinia` ^3.0

## Layout

- `src/index.ts` — public barrel.
- `src/builders.ts` — factories for `ConversationTurn`, `TurnToolCall`,
  `AttributedMessage`. Kept pure; no Vue / Pinia imports.
- `src/pinia.ts` — `setupPinia()` wrapper around `createPinia()` +
  `setActivePinia()`.
- `src/deferred.ts` — `createDeferred()` for tests that need to resolve a
  promise from outside its executor (e.g., awaiting IPC fakes).

## Related

See ADR [0006 — Frontend state via Pinia + run-style helpers](../../docs/adr/0006-frontend-state-pinia-run-helpers.md)
for why `setupPinia()` is required in every store test.
