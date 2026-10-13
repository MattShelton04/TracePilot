# Visual harness

Synthetic frontend capture, reports, policy tests and the trusted publisher.
See [visual regression](../../docs/visual-regression.md). The harness has its
own lockfile: install with `npm ci --prefix scripts/visual --ignore-scripts`.
Captures stay under ignored `.tracepilot/visual/`.

- `capture.mjs` — captures App views and Rich tools cases from `manifest.mjs` against a mock backend. README screenshots: `node scripts/visual/capture.mjs --suite=readme --docs` (synthetic `showcase/` workspace, not run in CI).
- `gallery-check.mjs` — browser regression for the generated report, run in unprivileged capture CI.
- `gallery/gallery.js`, `gallery/history.js`, `gallery/sections.js` — browser scripts the generated gallery pages load.
- `publish.mjs` — trusted `workflow_run` publisher; a CI workflow action, not a local diagnostic.

Tests: `node --test scripts/visual/*.test.mjs` and `python scripts/visual/extract_test.py`.
Keep the publisher's isolated dependency and trust boundary when changing this folder.
