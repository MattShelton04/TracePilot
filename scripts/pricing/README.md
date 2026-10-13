# Pricing tooling

The parsers, importer and freshness comparator behind `pnpm pricing:*`. See the
[pricing update workflow](../../docs/pricing-model.md#reproducible-update-workflow).
Versioned evidence lives under `packages/types/data/copilot-pricing/`; runtime
JSON changes only with `--write`.

- `claude-cli.mjs` — `pnpm pricing:claude`; parses and applies Anthropic's published price table (with `claude.mjs`).
- `cli.mjs` — `pnpm pricing:fetch`, `update`, `check` and `freshness` for Copilot pricing.
- `publish.mjs` — trusted CI entry point that maintains the one advisory freshness comment.

Tests: `pnpm test:pricing` runs the update, freshness, reporting and Claude
parser contracts.
