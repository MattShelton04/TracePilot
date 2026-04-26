# Copilot SDK Model-Catalog Fetch — Findings & Lessons Learned

**Status:** Shelved. All experimental code reverted on branch `Matt/Config_Update`.
**Archived branch tag:** `sdk-experiment-archive` (kept locally for reference; can be
recreated from the shas listed below if needed).

## TL;DR

Fetching the live Copilot model catalog through the Rust `copilot-sdk` crate is
attractive but currently not worth the implementation cost. Two upstream issues
combine to make every "elegant" approach degenerate into either silent data loss
or a maze of bypass code:

1. **Strict camelCase deserialiser, hybrid snake_case payload.** `ModelInfo`
   (and its nested `ModelLimits`, `ModelCapabilities`, …) is annotated with
   `#[serde(rename_all = "camelCase")]` at every level, but the Copilot CLI
   actually emits *hybrid* JSON — the `capabilities.limits` block (and a few
   others) is snake_case. Result: `max_context_window_tokens` and friends
   silently fall back to `Default` and the UI shows a blank Context column.
2. **Shape drift between CLI versions.** Even when we bypassed the SDK
   deserialiser and parsed the raw JSON ourselves, at least one CLI version
   delivered `capabilities.supports.vision` as an array of supported media
   types instead of a boolean (`["image/png", "image/jpeg"]`), tripping our
   strict parser with `invalid type: sequence, expected a boolean` and
   forcing the catalog UI to fall back to its stale on-disk cache with a
   scary "SDK unavailable" banner.

We attempted three escalating workarounds and abandoned all three. This doc
captures what was tried, what worked, what didn't, and what a future
implementation should consider before reopening the work.

## What we shipped (and reverted)

The reverted work spanned six commits on `Matt/Config_Update`:

| sha (archived) | Scope |
| --- | --- |
| `a17458be` | Plumb full SDK `ModelInfo` (multiplier, policy, capabilities) through `BridgeModelInfo` so the orchestrator could expose more than just the id list. |
| `3ada0015` | New `model_catalog` module — pure 3-pass merge of (a) live SDK results, (b) static `MODEL_REGISTRY`, and (c) on-disk cache, with a `MergedSdkStatus` / `MergedFreshness` / `isVerifiedActive` taxonomy. |
| `2f47d309` | Frontend "Model Explorer" view backed by the merged catalog (Tauri command + Vue panel). |
| `d50e7efe` | First bypass: when running in TCP / `--ui-server` mode, skip the SDK's typed deserialisation and call `models.list` over raw JSON-RPC, parsing the snake_case fields ourselves. |
| `347d4852` | Second bypass: same idea for the (default) stdio mode by spawning a one-shot parallel `copilot --server --stdio` subprocess just for `models.list`. |
| `4dfb06d9` | Defensive parser: switched the raw model fields from strictly-typed structs to `serde_json::Value` walks so unexpected shapes (the `vision: [..]` case) silently degrade instead of aborting the catalog refresh. |

Everything was kept behind a fallback chain (live SDK → cache → static
`MODEL_REGISTRY`), so the UI never went fully dark. But the cumulative
complexity — three RPC paths, a merge engine, a verified/unverified gate, a
cache file format, and ~200 lines of Windows `.cmd`→node-loader resolution
re-implemented because the SDK keeps it private — was disproportionate to
the value (a Context column and a few capability badges).

## What was actually wrong

### 1. The upstream SDK's `ModelInfo` deserialiser is broken

```rust
// copilot-sdk-rust/.../types.rs (rev 2946ba1)
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimits {
    pub max_prompt_tokens: Option<u32>,
    pub max_context_window_tokens: Option<u32>,
    // …
}
```

Empirically, the CLI emits:

```json
"limits": {
  "max_prompt_tokens": 128000,
  "max_context_window_tokens": 144000
}
```

`#[serde(rename_all = "camelCase")]` rewrites `max_prompt_tokens` →
`maxPromptTokens` at deserialisation time, so the field is missing from the
incoming JSON and the `Option<u32>` quietly becomes `None`. There is **no**
warning anywhere — the SDK call succeeds with empty limits. The same
mechanism breaks `supports.reasoning_effort`,
`supported_reasoning_efforts`, `default_reasoning_effort`, etc.

The hybrid is genuinely the API's fault: `capabilities.supports.vision` is
camelCase-friendly (single-word) and serialises identically either way, but
multi-word fields under `limits` are snake_case. Other SDKs (the JS one,
which the CLI itself uses) treat snake_case as the wire format.

### 2. The CLI's response shape is not stable across versions

We have first-hand evidence that the same field can change type between
versions of `@github/copilot`:

- Version A: `capabilities.supports.vision: true`
- Version B: `capabilities.supports.vision: ["image/png", "image/jpeg"]`

Whichever form is "more correct" is irrelevant for our purposes — any
strict mirror of the API will eventually break, and version skew between
the user's CLI and TracePilot's pinned SDK is *guaranteed* (the CLI
auto-updates). The SDK's own deserialiser is the worst-case manifestation
of this fragility.

### 3. None of the SDK's bypass primitives are first-class

The SDK exposes `JsonRpcClient`, `StdioJsonRpcClient`, `CopilotProcess`,
`StdioTransport`, `find_copilot_cli`, `find_node`, and `is_node_script` as
public — enough to build a parallel JSON-RPC pipe — but it keeps
`resolve_cli_command` private. On Windows that function is the only place
that knows how to turn `copilot.cmd` into a clean `node …\index.js`
invocation; `cmd /c copilot.cmd` corrupts JSON-RPC framing via pipe
inheritance issues (per a comment in the SDK source). We had to
re-implement ~60 lines of resolution logic inside TracePilot just to spawn
a working subprocess.

The SDK's `copilot_sdk::Client` does not expose its underlying
`JsonRpcClient` either — there is no way to send a raw method call through
the bridge's existing connection. Every workaround therefore opens a
second, parallel CLI process for every catalog refresh (~1–3 s cold-start
on Windows; observable in the UI).

## What worked

- **Static registry as the source of truth.** `MODEL_REGISTRY` already
  carries everything we need for pricing, vendor classification, premium
  weight, and reasoning-effort defaults. The UI does not actually require
  a live catalog to function — it only enriches the picker.
- **The merge engine itself.** The `Live | Unavailable` × cache 3-pass merge
  was clean code and the right approach if/when a usable live source
  exists. Worth resurrecting wholesale.
- **Defensive parsing via `serde_json::Value` walks.** When/if we re-attempt
  the live fetch, *do not* deserialise into named structs. Walk the JSON
  with field-by-field type coercion so a single shape change in any
  capability/limit field silently degrades that one field rather than
  aborting the request.
- **The on-disk cache (`<app_data>/model-catalog/sdk-models-v1.json`).**
  Survived multiple iterations and provided a usable fallback every time
  the live path broke.

## What didn't work (and why)

- **Trusting the SDK's typed `ModelInfo`.** Silent data loss; impossible to
  detect without comparing against raw JSON. Non-starter.
- **TCP-only raw RPC bypass.** Worked when reachable, but most users run
  in default stdio mode — the bypass only helped a niche `--ui-server`
  cohort.
- **Stdio raw RPC by spawning a parallel one-shot subprocess.** Functionally
  correct but expensive: 1–3 s extra per refresh, ~190 lines of
  Windows-aware spawn code, and *still* tripped on the
  `vision: [array]` shape change because we hadn't yet made the parser
  defensive.
- **A defensive `Value`-walking parser layered on top of the stdio
  bypass.** Robust against shape drift but the cumulative architecture
  (3-tier fallback chain + parallel subprocess + custom parser + cache +
  merge engine + verified/unverified UI taxonomy) is more code than the
  feature is worth right now.

## Lessons & recommendations for a future attempt

1. **Don't depend on the upstream `ModelInfo` shape at all.** Either parse
   `serde_json::Value` directly or vendor a permissive snake_case mirror
   in this repo; never re-deserialise typed SDK structs.
2. **Get a raw-RPC handle on the SDK's existing connection before
   adding more processes.** A small upstream PR that exposes
   `Client::raw_invoke(method, params) -> Value` would obviate the entire
   parallel-subprocess machinery and is the highest-leverage upstream
   change. Worth filing.
3. **Treat the catalog as best-effort metadata, not a primary data
   source.** The session launcher and config injector should *prefer* the
   static registry and only consult live data when explicitly requested
   (e.g. an "active" filter on the Models page). This avoids surfacing
   transient SDK errors as scary UI states.
4. **If a live fetch is re-introduced, it must be opt-in and silent on
   failure** — log a warning, keep using the static registry, and surface
   the SDK status in a single inconspicuous indicator rather than a
   full-width banner.
5. **Pin the empirical wire format with golden-file tests.** Capture a real
   `models.list` response per supported `@github/copilot` version into
   `tests/fixtures/` and round-trip it through whatever parser we end up
   with. This is the only realistic guard against shape drift.
6. **Don't build a "Model Explorer" view as a separate surface.** The
   existing Models tab is the right home; adding a parallel view doubled
   maintenance for no clear UX win during the experiment.

## Out-of-scope but kept

The same branch shipped four unrelated improvements that are *not* part of
this revert:

- Adapting `ConfigInjector` to the Copilot CLI's `settings.json`
  migration (separate from internal `config.json`).
- Adding GPT-5.5 to the static `MODEL_REGISTRY`.
- Replacing the "Upgrade All to Opus" batch action with a neutral model
  picker.
- Capping the batch-model select width and dropping the redundant
  Total-Premium-Weight stat card.

These have nothing to do with the SDK fetch and remain on the branch.

## References

- Upstream SDK source: `copilot-sdk-rust` rev `2946ba1`,
  `crates/copilot-sdk/src/types.rs:1217-1226` (the `ModelLimits`
  rename_all annotation).
- Local SDK checkout while debugging:
  `C:\Users\mattt\.cargo\git\checkouts\copilot-sdk-rust-33a5081cb6261a92\2946ba1\`.
- Cache file inspected during debugging:
  `<app_data>\dev.tracepilot.app\model-catalog\sdk-models-v1.json`
  — every model showed `"limits": {}` with the SDK-typed path,
  populated correctly with the `Value`-walking parser.
- Related existing notes: `docs/copilot-sdk-deep-dive.md`,
  `docs/copilot-sdk-rpc-method-bug.md`,
  `docs/copilot-sdk-integration-evaluation.md`.
