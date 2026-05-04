# Copilot pricing model refresh

TracePilot's pricing model is moving from a single premium-request estimate plus configurable wholesale token rates to a small, typed pricing registry backed by versioned pricing data. It can compare legacy premium-request billing, GitHub usage-based token billing, local token-rate estimates, and observed AI Credit telemetry when present.

## Source assumptions

- GitHub announced that all Copilot plans transition to usage-based billing on **June 1, 2026**. Premium request units are replaced by GitHub AI Credits, and usage is calculated from token consumption including input, output, and cached tokens using the listed API rates for each model. Source: [GitHub Blog, "GitHub Copilot is moving to usage-based billing"](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/).
- GitHub's Copilot models/pricing reference states that model prices are listed **per 1 million tokens**, and **1 GitHub AI Credit = $0.01 USD**. It also distinguishes input, cached input, output, and Anthropic cache-write costs. Source: [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
- GitHub's usage-based billing docs state that Copilot CLI usage consumes AI Credits, while code completions and Next Edit suggestions remain included and are not billed in AI Credits. Sources: [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals) and [Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises).
- Annual Copilot Pro/Pro+ subscribers who remain on request-based billing after June 1, 2026 keep premium-request billing but receive changed model multipliers. These multipliers do **not** apply to usage-based billing. Source: [Model multipliers for annual plans staying on request-based billing](https://docs.github.com/en/copilot/reference/copilot-billing/model-multipliers-for-annual-plans).

## Model

TracePilot now treats prices as effective-dated registry entries. A rate can describe:

- the model id and aliases used by Copilot events, GitHub docs, or provider APIs;
- the billing provider/source (`github-copilot`, `provider-wholesale`, or `user`);
- the pricing kind (`legacy-premium-request`, `usage-token-rate`, or `observed-nano-aiu`);
- token rates for input, cached input, cache write, output, and reasoning where known;
- premium-request multipliers where applicable;
- currency/unit, effective dates, source label/URL, and confidence/status.

The shipped registry is read-only and generated from `packages/types/src/pricing-data.json`, which contains the source URLs, verification date, effective date, aliases, token rates, and annual-plan multipliers. User edits in `pricing.models` remain local overrides and are layered above defaults without mutating the shipped registry.

## Historical sessions and switchover

TracePilot preserves old sessions by keeping the premium-request estimate available as **Legacy Copilot**. Usage-based estimates are calculated from token usage and GitHub's official model rates, effective from **2026-06-01** by default. For historical analysis, TracePilot can evaluate:

- **session-time rates**, using the rates effective at the session or segment timestamp;
- **latest rates**, re-pricing older usage with the newest registry entries;
- **comparison/preview**, showing old-vs-new estimates and the delta around the June 2026 switchover.

The current UI focuses on comparison/preview for individual session metrics while keeping the lower-level rate engine ready for broader selectable modes later.

## Cost surfaces

- **Legacy Copilot**: `premiumRequests * costPerPremiumRequest`. This is retained for pre-switchover sessions and annual-plan users that remain request-billed.
- **GitHub Copilot (usage)**: token usage multiplied by GitHub Copilot model rates. This is the forward-looking estimate for monthly plans after June 1, 2026.
- **Direct API (estimate)**: configurable local token rates, preserving TracePilot's previous provider/direct-API estimate workflow. Defaults for models listed on GitHub's pricing page are derived from the same `pricing-data.json` rows as GitHub Copilot usage estimates, so the two estimates align by default. They only diverge when a user overrides local rates or when a model is not present in GitHub's published usage table and TracePilot falls back to a clearly marked legacy estimate.
- **Observed AI Credits**: shown when `totalNanoAiu` exists. TracePilot treats it as observed telemetry and does not silently substitute it for calculated costs unless the units are explicit enough to display.

Unknown models or missing prices are surfaced as unknown instead of falling back to a possibly wrong model price. After June 2026, no code change should be needed for the estimate path: the shipped effective date already exists, and sessions with `totalNanoAiu` can additionally show observed AI Credit telemetry when the CLI emits it.

## Pricing updates

Pricing updates should be made in `packages/types/src/pricing-data.json`, not in calculator code. That keeps source attribution, effective dates, aliases, GitHub Copilot usage rates, and default local token-rate estimates in one auditable place. The TypeScript registry derives:

- `github-copilot` usage entries with the June 1, 2026 effective date;
- `provider-wholesale` defaults that mirror those same published token rates for documented models;
- clearly marked legacy estimates for models not present on GitHub's published pricing page;
- annual-plan premium-request multipliers from the separate GitHub multiplier reference.

Local settings remain explicit user overrides for the Direct API estimate and are persisted in TracePilot's existing config file. Effective-date editing is intentionally display-only in this MVP; a future refresh command can update the JSON data file from GitHub's pricing page without changing calculation logic.

## Alias handling

Copilot event model names may not match GitHub documentation or provider names exactly. TracePilot normalizes model names and uses explicit aliases from the registry before falling back to conservative exact/prefix matching. This avoids fragile substring-only matching and makes unknown models visible.

## Future opportunities

The registry enables budget burn-down, included-credit utilization, model-switch recommendations, per-segment cost attribution, forecast views using latest vs session-time rates, and reconciliation between observed AIU telemetry and TracePilot's token-rate estimate.
