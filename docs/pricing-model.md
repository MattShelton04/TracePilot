# Copilot pricing model refresh

TracePilot treats GitHub AI Credits (AIC) as its primary billing quantity. A small, typed pricing registry backed by versioned pricing data supports estimates for older sessions, while legacy premium-request and direct-API views remain compatibility data rather than the headline cost.

## Source assumptions

- GitHub announced that all Copilot plans transition to usage-based billing on **June 1, 2026**. Premium request units are replaced by GitHub AI Credits, and usage is calculated from token consumption including input, output, and cached tokens using the listed API rates for each model. Source: [GitHub Blog, "GitHub Copilot is moving to usage-based billing"](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/).
- GitHub's Copilot models/pricing reference states that model prices are listed **per 1 million tokens**, and **1 GitHub AI Credit = $0.01 USD**. It also distinguishes input, cached input, output, and Anthropic cache-write costs. Source: [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
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

## Cost surfaces

- **AI Credits**: the primary session, model, segment, comparison, CLI, and analytics value. One billion nano-AIU equals one AIC, and one AIC has a $0.01 USD billing equivalent.
- **Estimated AI Credits**: used only where observed telemetry is absent. The UI labels whether GitHub token rates or direct-API rates supplied the estimate.
- **Legacy Copilot**: `premiumRequests * costPerPremiumRequest`. Retained for old request-billed sessions and shown only as compatibility data.
- **Direct API (estimate)**: configurable local token rates retained as the last estimate fallback and for settings compatibility.

Unknown models or missing prices are surfaced as unavailable instead of falling back to a possibly wrong model price.

## Pricing updates

Pricing updates should be made in `packages/types/src/pricing-data.json`, not in calculator code. That keeps source attribution, effective dates, aliases, GitHub Copilot usage rates, context tiers, and default local token-rate estimates in one auditable place. The TypeScript registry derives:

- `github-copilot` usage entries with the June 1, 2026 effective date;
- `provider-wholesale` defaults that mirror those same published token rates for documented models;
- editable default and long-context rows under the same model identity;
- current premium-request multipliers used by launch/settings defaults;
- clearly marked legacy estimates for models not present on GitHub's published pricing page;
- annual-plan premium-request multipliers from the separate GitHub multiplier reference.

Local settings remain explicit user overrides for the Direct API estimate and are persisted in TracePilot's existing config file. Effective-date editing is intentionally display-only in this MVP; a future refresh command can update the JSON data file from GitHub's pricing page without changing calculation logic.

## Alias handling

Copilot event model names may not match GitHub documentation or provider names exactly. TracePilot normalizes model names and uses explicit aliases from the registry before falling back to conservative exact/prefix matching. This avoids fragile substring-only matching and makes unknown models visible.

## Future opportunities

The registry enables budget burn-down, included-credit utilization, model-switch recommendations, per-segment cost attribution, forecast views using latest vs session-time rates, and reconciliation between observed AIU telemetry and TracePilot's token-rate estimate.
