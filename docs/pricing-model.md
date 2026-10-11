# Copilot pricing model refresh

TracePilot treats GitHub AI Credits (AIC) as its primary billing quantity. A small, typed pricing registry backed by versioned pricing data supports estimates for older sessions, while legacy premium-request and direct-API views remain compatibility data rather than the headline cost.

## Source assumptions

- GitHub announced that all Copilot plans transition to usage-based billing on **June 1, 2026**. Premium request units are replaced by GitHub AI Credits, and usage is calculated from token consumption including input, output, and cached tokens using the listed API rates for each model. Source: [GitHub Blog, "GitHub Copilot is moving to usage-based billing"](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/).
- GitHub's Copilot models/pricing reference states that model prices are listed **per 1 million tokens**, and **1 GitHub AI Credit = $0.01 USD**. It distinguishes input, cached input, output, and cache-write costs for Anthropic, GPT-5.6, and GPT-6 models. Source: [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
- GitHub's usage-based billing docs state that Copilot CLI usage consumes AI Credits, while code completions and Next Edit suggestions remain included and are not billed in AI Credits. Sources: [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals) and [Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises).
- Annual Copilot Pro/Pro+ subscribers who remain on request-based billing after June 1, 2026 keep premium-request billing but receive changed model multipliers. These multipliers do **not** apply to usage-based billing. TracePilot records both the current multiplier and the June 2026 annual-plan multiplier in the pricing data file so launcher/default settings do not drift from the preview registry. Source: [Model multipliers for annual plans staying on request-based billing](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans).

## Model

TracePilot now treats prices as effective-dated registry entries. A rate can describe:

- the model id and aliases used by Copilot events, GitHub docs, or provider APIs;
- the billing provider/source (`github-copilot`, `provider-wholesale`, or `user`);
- the pricing kind (`legacy-premium-request`, `usage-token-rate`, or `observed-nano-aiu`);
- the model's pricing tier (`default` or `long-context`) and minimum input-token threshold;
- token rates for input, cached input, cache write, output, and reasoning where known;
- optional long-context tiers selected from the total input-token count;
- premium-request multipliers where applicable;
- currency/unit, effective dates, source label/URL, and confidence/status.

The shipped registry is read-only and generated from `packages/types/src/pricing-data.json`, which contains the source URLs, verification date, effective date, aliases, model-specific token-rate tiers, current premium-request multipliers, and June 2026 annual-plan multipliers. Multiple rate tiers retain one model identity; the resolver selects the highest applicable threshold for the observed total input-token count. For models missing from GitHub's annual multiplier table, TracePilot records the current fallback multiplier in `currentPremiumRequestDefaults` so launch/settings defaults still come from the shared pricing data file instead of calculator code. User edits in `pricing.models` remain local overrides and are layered above defaults without mutating the shipped registry.

## Historical sessions

TracePilot merges old and new sessions using this precedence:

1. observed `totalNanoAiu` telemetry;
2. an AIC estimate calculated from recorded tokens and GitHub's published Copilot rates;
3. an AIC estimate converted from the configured direct-API token rate;
4. unavailable, with legacy premium requests shown separately when present.

Premium requests are never converted into AIC because the units are not equivalent. Analytics separately aggregate observed coverage and only estimate token usage belonging to sessions without observed telemetry, preventing double counting when historical and current sessions are viewed together.

Desktop session metrics, activity tiles and comparisons share null-aware shutdown
accounting. A combined token total or token-based credit estimate requires recorded
input and output counts for every included model. Partial counts remain visible in
their own categories, while the combined value is unavailable. An unpriced model
also makes a session-wide estimate unavailable instead of exposing a partial
subtotal. Recorded zero counts and observed zero credits remain valid values;
comparisons suppress deltas when either side is unavailable. An empty model map
cannot establish zero usage because the backend also normalizes missing maps to
empty maps. Models with explicit zero token counts estimate zero even without a
price. If a model reports positive observed credits alongside zero token counts,
its direct API estimate remains unavailable. The session credit estimate is also
unavailable without an observed session total. Observed session totals, including
zero, remain authoritative. Optional cache counts retain the existing pricing
fallback to zero.

## Cost surfaces

- **AI Credits**: the primary session, model, segment, comparison, CLI, and analytics value. One billion nano-AIU equals one AIC, and one AIC has a $0.01 USD billing equivalent.
- **Estimated AI Credits**: used only where observed telemetry is absent. The UI labels whether GitHub token rates or direct-API rates supplied the estimate.
- **Legacy Copilot**: `premiumRequests * costPerPremiumRequest`. Retained for old request-billed sessions and shown only as compatibility data.
- **Direct API (estimate)**: configurable local token rates retained as the last estimate fallback and for settings compatibility.

Unknown models or missing prices are surfaced as unavailable instead of falling back to a possibly wrong model price.

## Pricing updates

Pricing updates should be made in `packages/types/src/pricing-data.json`, not in calculator code. That keeps source attribution, effective dates, aliases, GitHub Copilot usage rates, context tiers, and default local token-rate estimates in one auditable place. The TypeScript registry derives:

- `github-copilot` usage entries with per-row effective dates, defaulting to the June 1, 2026 billing transition;
- `provider-wholesale` defaults that mirror those same published token rates for documented models;
- editable default and long-context rows under the same model identity;
- current premium-request multipliers used by launch/settings defaults;
- clearly marked legacy estimates for models not present on GitHub's published pricing page;
- annual-plan premium-request multipliers from the separate GitHub multiplier reference.

Local settings remain explicit user overrides for the Direct API estimate and are persisted in TracePilot's existing config file. Effective-date editing is display-only. The offline importer described below updates the bundled rates and shared model defaults without touching saved settings.

### Reproducible update workflow

Run these commands from the repository root with Node 22 and pnpm 10 dependencies installed. The implementation lives in [`scripts/pricing/`](../scripts/pricing/cli.mjs).

1. Review the [published token table](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) and the [annual legacy multiplier table](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans), including footnotes. Optionally run `pnpm pricing:freshness` first to see what changed. Check that the fetched data agrees with the rendered documentation; documentation deployments can lag source commits.
2. Run **`pnpm pricing:fetch`**. The script resolves `github/docs` main to a full commit SHA once, downloads every source at that immutable revision, and defaults the verification date to today in UTC. No SHA lookup or date argument is needed. For an exact historical replay, use `pnpm pricing:fetch --revision <40-character-SHA> --date YYYY-MM-DD`. This downloads the two YAML tables and extracts the pricing page's footnotes. It writes the evidence in [`packages/types/data/copilot-pricing/`](../packages/types/data/copilot-pricing/snapshot.json), without changing runtime prices. The snapshot records the revision, date, and SHA-256 digests of the upstream LF text. The pricing page itself can be retrieved using the `page` path in `scripts/pricing/source.mjs` at that revision. An optional `GITHUB_TOKEN` authenticates the revision lookup; it is not sent to the raw-file host.
3. Review new model identities. Add confirmed IDs, display names, and tiers to [`model-registry.json`](../packages/types/data/model-registry.json), explicit display-name aliases to `pricing-data.json`, and a local compatibility multiplier if required by the settings schema. Token-rate fields in model metadata are synchronized by the importer. Do not invent an official legacy multiplier for a new usage-billed model. New aliases must resolve to exactly one identity; annual-only historical models may exist solely in the alias map.
4. Review changed footnotes in [`policy.json`](../packages/types/data/copilot-pricing/policy.json). The importer requires the exact reviewed text and an explicit exclusive expiry date for promotional rates. Unknown or changed footnotes, new columns/providers, malformed prices, and incomplete context tiers stop the update. If upstream changes its schema or billing semantics, update the parser and tests deliberately. Do not bypass the checks by removing footnotes or entering zero for an unknown price.
5. Run `pnpm pricing:update` for a dry run, then `pnpm pricing:update --write`. This reconciles current rows, archives changed tier sets and annual multipliers, and synchronizes Rust/TypeScript model defaults. Run `pnpm exec biome format --write packages/types/src/pricing-data.json packages/types/data/model-registry.json packages/types/data/copilot-pricing` and inspect the Git diff. Formatting is separate; the drift check compares JSON values, not whitespace or key order.
6. Independently update the published-rate expectations in [`copilot-pricing-snapshot.test.ts`](../packages/types/tests/copilot-pricing-snapshot.test.ts), the source row counts/date expectations in [`update.test.mjs`](../scripts/pricing/update.test.mjs), and relevant new-model/default tests. These expectations are deliberately not generated by the importer. Update the snapshot notes below and the Rust registry size assertion when adding identities.
7. Run the validation commands below, then commit the evidence, generated data, tests, and documentation together. No network access is needed to replay or validate the checked-in snapshot.

```sh
pnpm pricing:check
pnpm test:pricing
pnpm --filter @tracepilot/types test
pnpm --filter @tracepilot/desktop exec vitest run src/stores/preferences/__tests__/pricing.test.ts src/stores/preferences/__tests__/pricing-defaults.test.ts
pnpm typecheck
cargo test -p tracepilot-tauri-bindings config::defaults::tests
cargo test -p tracepilot-orchestrator models::tests
```

`pricing:update --write` is idempotent: replaying the same snapshot leaves the JSON values and history unchanged. There is no application runtime network dependency. To undo an uncommitted refresh, restore the affected evidence and data files together through Git; do not lower the snapshot date to force a rollback.

### CI consistency and live freshness checks

| Check | What it verifies | Effect |
| --- | --- | --- |
| `pnpm pricing:check` and `pnpm test:pricing` | Frozen-source hashes, reviewed assumptions, runtime rates, shared defaults, and importer/reporting behavior | Required CI consistency check. Runs without network access and fails on mismatches. It does not establish that the snapshot is still the newest published pricing. |
| `pnpm pricing:freshness` | Latest GitHub source against the saved source, including both context tiers, thresholds, new/removed models, annual multipliers, footnotes, and expired promotions | Advisory workflow on every PR, also available manually. Writes a job summary and JSON artifact; outdated pricing or network failures never fail the CI gate. |

The live comparison resolves and pins the upstream revision automatically without modifying the snapshot or application prices. It ignores YAML formatting, row order, equivalent price spellings, and release/category metadata. A newer unrelated documentation commit alone does not make pricing stale. Local command exit codes are `0` (current), `1` (outdated), and `2` (could not verify); the workflow explicitly treats nonzero results as advisory. `--report <path>` optionally saves the JSON result. Network errors, rate limits, and invalid source data are reported as **could not verify**, never as current pricing.

When pricing is outdated, the reporting workflow creates one bot comment with the affected models/tiers, old/new values, source links, and the refresh command. Further runs update that comment; a successful refresh updates it to resolved. Current pricing creates no new comment. An unavailable check updates an existing advisory without claiming that pricing is current; otherwise its warning stays in the job summary.

The comment publisher uses the repository's existing trusted `workflow_run` pattern: only default-branch code runs with comment permissions, including for fork PRs. It validates the bounded JSON artifact, correlates it with the current open PR head and run attempt, and escapes source text. PR code runs with read-only permissions. **The comment publisher becomes active after these workflow files are merged to the default branch**; the live check and its summary can run on the introducing PR immediately.

### Short and long context

Each model's default and long-context rates remain separate rows under the same identity. The tier is selected using **total input tokens, including cache reads and cache writes**, and its input/cache/output prices apply to the full request, not just tokens above the threshold. GPT-6 Sol and Luna use the default tier through 272,000 input tokens and the long-context tier starting at 272,001. Claude Haiku 5.5 uses its default tier through 100,000 input tokens and its long-context tier starting at 100,001. Opus 5.5 has no published long-context surcharge and keeps its single rate. Both importer validation and the live comparison include thresholds and every tier; calculation tests cover both sides of the boundary. Aggregated session totals still cannot reconstruct individual request boundaries, so historical aggregate estimates retain that limitation.

### History and retention rules

- A newly observed model or changed price takes effect at the verified snapshot date. This is TracePilot's estimation boundary, not a claim about the model's launch or the actual price-change date.
- A change to any rate, threshold, tier set, or promotion expiry archives the model's complete previous tier set in `githubCopilotUsageHistory`. Old rows retain their verification date and end exclusively at the new boundary (or their earlier published expiry). Annual multiplier changes similarly use `annualLegacyMultiplierHistory`.
- Unchanged prices keep their effective start date and receive the current verification date. A model absent from the source keeps its last known prices and verification date with a retention note. Absence alone does not establish a retirement date. Such entries remain usable for estimates, including undated estimates, and do not claim current model availability.
- Dated lookups select effective historical entries. Undated and explicit `latest` lookups exclude superseded history, so a removed long-context tier cannot outrank its replacement. Explicit latest lookups still use the last published promotional snapshot; dated lookups honor its expiry.
- Source files and their revisions are preserved in Git history. Neither old sessions nor observed `totalNanoAiu` billing telemetry are rewritten. User Direct API overrides and intentional model removals remain intact; newly bundled models/tiers are backfilled by the preferences store.

When GitHub removes a whole model from a table, the importer retains it in `githubCopilotUsage` or `annualLegacyMultipliers`; it does not delete the model or move it into closed history. Its aliases, model metadata, compatibility defaults, last verified date, and any published promotion expiry are preserved. This differs from a changed price or removed context tier, where the previous tier set is archived with an exclusive end date. A later dated estimate can therefore still use a delisted model's last known rate, subject to its published expiry. It is an estimate from retained evidence, not confirmation of current pricing or model availability.

The bundled model registry also supplies launcher and config-editor model lists, so retained identities can still appear in those menus. Those lists are local metadata, not a live Copilot availability check. The SDK's separate model-list query reflects what the connected Copilot client reports. Removing a model in local Direct API settings only suppresses its editable defaults during merges; it does not remove the bundled Copilot pricing evidence used by historical estimates.

### October 10, 2026 snapshot

Verified against `github/docs` revision [`be38ec5d78e24172587e61b3c6ff40ace1865c71`](https://github.com/github/docs/commit/be38ec5d78e24172587e61b3c6ff40ace1865c71) and both rendered references. The source contains **45 token-rate rows** and **16 annual-plan multipliers**. Claude Haiku 5.5 is newly registered, and Claude Sonnet 5.5's cached-input rate changes:

| Model | Input | Cached input | Cache write | Output | Long-context threshold |
| --- | ---: | ---: | ---: | ---: | --- |
| Claude Haiku 5.5 | $0.10 | $0.01 | $0.125 | $0.50 | Above 100,000 input tokens: $0.50 / $0.05 / $0.625 / $2.50 |
| Claude Sonnet 5.5 | $2 | $0.10 (previously $0.20) | $2.50 | $10 | None published |

Amounts are USD per million tokens; long-context rates apply to the entire request. New and changed rows begin at TracePilot's **2026-10-10 verification boundary**, which does not establish the actual launch or price-change date. Sonnet 5.5's previous row remains in `githubCopilotUsageHistory`, verified October 4 and ending exclusively at October 10, so dated estimates preserve the old cache rate.

All other listed token rates, annual multipliers, retained entries and earlier history are unchanged. The reviewed Gemini promotion footnote and exclusive expiry `2027-01-01` are unchanged. GitHub publishes no annual legacy multiplier for Haiku 5.5; its `currentPremiumRequestDefaults` value is an explicitly labeled local compatibility placeholder. Shared Rust/TypeScript defaults include both Haiku tiers and Sonnet's new cache rate; saved Direct API overrides and intentional model removals remain intact.

### October 4, 2026 snapshot

Verified against `github/docs` revision [`2bd66de8cea336061c9ea060c9b37385136e6ab3`](https://github.com/github/docs/commit/2bd66de8cea336061c9ea060c9b37385136e6ab3) and both rendered references. The source contains **43 token-rate rows** and **16 annual-plan multipliers**. Two identities are newly registered:

| Model | Input | Cached input | Cache write | Output | Long-context threshold |
| --- | ---: | ---: | ---: | ---: | --- |
| Claude Sonnet 5.5 | $2 | $0.20 | $2.50 | $10 | None published |
| GPT-6.1 Sol | $2 | $0.10 | $2.50 | $10 | Above 272,000 input tokens: $4 / $0.20 / $5 / $15 |

Amounts are USD per million tokens; long-context rates apply to the entire request. New rows begin at TracePilot's **2026-10-04 verification boundary**. Existing listed rates and multipliers are unchanged. GitHub publishes no annual legacy multipliers for these new models; their `currentPremiumRequestDefaults` values are explicitly labeled local compatibility placeholders.

Claude Opus 4.7, Gemini 3.5 Flash, Gemini 3.6 Flash, and Kimi K2.7 Code are absent from the token table. Opus 4.7 and Gemini 3.5 Flash are also absent from the annual table. All retain their September 27 prices, verification dates, and identities with an October 4 retention note. No retirement date or replacement-model price is inferred. Earlier retained entries and closed pricing history remain unchanged.

The reviewed Gemini promotion footnote now names only Gemini 3.7 and 3.8 Flash. Their exclusive expiry remains `2027-01-01`; the retained Gemini 3.6 rate keeps that same previously published expiry. Delisting does not extend a promotion.

### September 27, 2026 snapshot

Verified against `github/docs` revision [`18945a31a4f2d97beb6c5c1a7479102e23c25727`](https://github.com/github/docs/commit/18945a31a4f2d97beb6c5c1a7479102e23c25727) and the rendered references. All **44 token-rate rows** and **18 annual-plan multipliers** are covered. Four identities are newly registered:

| Model | Input | Cached input | Cache write | Output | Long-context threshold |
| --- | ---: | ---: | ---: | ---: | --- |
| Claude Opus 5.5 | $4 | $0.20 | $5 | $20 | None published |
| GPT-6 Sol | $2 | $0.20 | $2.50 | $10 | Above 272,000 input tokens: $4 / $0.40 / $5 / $15 |
| GPT-6 Luna | $0.10 | $0.01 | $0.125 | $0.50 | Above 272,000 input tokens: $0.20 / $0.02 / $0.25 / $0.75 |
| Grok 4.7 | $2 | $0.50 | $0 | $6 | Above 200,000 input tokens: $4 / $1 / $0 / $12 |

Amounts are USD per million tokens; long-context rates are listed in the same column order and apply to the entire request. Existing listed prices and annual multipliers are unchanged. MAI-Code-1-Flash is absent from both current tables, so its September 10 attribution is retained explicitly. GitHub publishes no legacy multipliers for the four new models; their local compatibility values are not official billing rates. Gemini 3.6–3.8 Flash promotions still expire at the exclusive boundary `2027-01-01`.

### September 10, 2026 snapshot

The refresh covers all 38 token-rate rows in [GitHub's Copilot pricing table](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), including ten newly registered models: GPT-6 Astra, Claude Opus 5, Claude Fable 5.1, Gemini 3.6/3.7/3.8 Flash, MAI-Code-1.1-Flash, Grok 4.5/4.6, and Kimi K3. GPT-5.6 Sol, Terra, and Luna have updated input/output/cache rates and now charge for cache writes. Astra and Grok have both default and long-context tiers. These are Copilot rates; the existing Direct API defaults mirror them for compatibility.

Astra costs $10 input, $1 cached input, $12.50 cache write, and $50 output per million tokens up to 272,000 total input tokens. Above that threshold, the full request uses $20/$2/$25/$75 respectively. Cache reads and writes are included in total input telemetry and subtracted before charging ordinary input.

New and changed rows use **2026-09-10 as TracePilot's verified snapshot boundary**, not a claim about the actual model launch or price-change date. The source does not establish those dates. The previous GPT-5.6 rows remain in `githubCopilotUsageHistory`, ending at that boundary, so dated estimates retain their prior rates. Undated comparisons use the latest snapshot. Retained models absent from the current tables keep their July verification date and an explicit source note. They remain usable for historical estimates without implying current Copilot availability.

Gemini 3.6–3.8 Flash promotional rates end on December 31, 2026. Their exclusive `effectiveTo` is `2027-01-01`; dated lookups after that return unavailable until new rates are verified. An explicit latest-rate lookup (including the editable Direct API view) still means the latest published snapshot, not a forecast of future prices.

The [legacy annual-plan multiplier table](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans) was also rechecked. Existing listed multipliers are unchanged; MAI-Code-1.1-Flash adds 0.25×. New models without a published multiplier have no official legacy pricing entry. Their numeric `currentPremiumRequestDefaults` values are local compatibility placeholders required by the existing settings schema, not Copilot billing rates. Earlier `currentPremiumRequests` defaults remain compatibility values separate from the official annual-plan `premiumRequests` multipliers.

### Implementation path

- `packages/types/src/pricing-data.json` owns Copilot rates, aliases, provenance, historical rows, and annual multipliers. `pricing-registry.ts` builds the effective-dated registry; `pricing.ts` resolves models/tiers and converts token costs to AIC.
- `packages/types/data/model-registry.json` supplies model identity and tier metadata to TypeScript and the Rust orchestrator. Default token rates are kept consistent with the Copilot snapshot.
- `packages/types/src/models.ts` and `crates/tracepilot-tauri-bindings/src/config/defaults.rs` produce editable default prices from the same data, including cache writes, context tiers, and source notes. Saved user overrides are preserved; new model rows are backfilled by the desktop preferences store.
- Observed `totalNanoAiu` remains authoritative. Token-based values remain estimates; applying context tiers to aggregated session/model token counts cannot reconstruct individual request boundaries.

## Claude Code API rates

Claude Code sessions are priced separately from Copilot, in API-equivalent USD (see [Claude Code sessions](claude-code-sessions.md#costs-are-estimates)). The rates live in [`claude-code-pricing-data.json`](../packages/types/src/claude-code-pricing-data.json); `claude-code-pricing.ts` and the Rust estimator in `tracepilot-core` (`provider/claude_code/pricing.rs`) both read it. Each entry carries input, cache-hit, 5-minute and 1-hour cache-write, and output rates. Claude Haiku 5.5 has two rows: its long-context row (`minimumInputTokens: 100001`) applies to a request whose input, cache reads and writes included, is over 100,000 tokens. Each call is priced on its own, so the tier follows each request. A model id resolves through its dotted name, the dashed form Claude Code records (`claude-haiku-5-5`), and dated snapshots (`claude-haiku-5-5-20261001`); other suffixes stay unpriced.

`pnpm pricing:claude` refreshes the file from [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing), using its Markdown variant:

1. Run `pnpm pricing:claude` to preview. It lists added and changed rows, models no longer on the page (kept and reported, never deleted), and the table's footnotes for review. It exits `0` when current, `1` when outdated and `2` when the page could not be fetched or parsed. `--report <path>` saves the result as JSON.
2. Run `pnpm pricing:claude --write` to apply the rows and set `verifiedAt` to today in UTC (`--date YYYY-MM-DD` overrides it). Then run `pnpm exec biome format --write packages/types/src/claude-code-pricing-data.json` and review the diff.
3. Update the expectations in `packages/types/tests/claude-code-pricing.test.ts` and the Rust pricing tests, and bump `CLAUDE_CODE_ANALYTICS_VERSION` so indexed Claude sessions are re-priced.

The parser maps display names such as "Claude Haiku 5.5" to ids (`claude-haiku-5.5`) and accepts only the known columns, `$N / MTok` prices, status notes (retired, limited availability) and prompt-length tiers. Any other column, qualifier, price format or model name, an incomplete tier pair, or prices in an implausible order (for example a cache hit above base input) stops the run before anything is written. Change the parser and its tests (`scripts/pricing/claude.test.mjs`, run by `pnpm test:pricing`) deliberately when Anthropic changes the table. Footnote markers are dropped from prices; the footnotes are printed so a promotional or conditional rate is noticed. The file keeps no rate history: a changed rate re-prices older sessions when they are re-indexed.

## Alias handling

Copilot event model names may not match GitHub documentation or provider names exactly. TracePilot normalizes case, whitespace, underscores, and the `models/` prefix, then matches explicit IDs/aliases. A dated provider snapshot suffix (`-YYYYMMDD` or `-YYYY-MM-DD`) may resolve to its known model. Arbitrary variant suffixes no longer inherit a parent's rates: an unpublished `gpt-6-sol-mini` or `claude-opus-5.5-fast` returns unavailable. Register verified variants explicitly during the update workflow. Observed billing telemetry remains usable even when a token price is unavailable.

## Future opportunities

The registry enables budget burn-down, included-credit utilization, model-switch recommendations, per-segment cost attribution, forecast views using latest vs session-time rates, and reconciliation between observed AIU telemetry and TracePilot's token-rate estimate.
