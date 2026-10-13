# CI helpers

Job selection, required-gate verification and PR comparison helpers used by
the workflows. Not standalone user commands.

- `classify-changes.mjs` — selects application checks from the complete PR merge diff; `--verify-required` strictly verifies the required job results. Consumes GitHub event/output or `CI_NEEDS` data.
- `compare-refs.mjs` — resolves the base and head revisions a PR comparison workflow measures.
- `report-comment.mjs` — keeps one report comment per PR and family, edited in place.

Tests: `node --test scripts/ci/*.test.mjs` uses isolated scratch repositories.
The CI policy job also runs checksum-pinned actionlint with the runner's
ShellCheck to validate workflows, expressions, action inputs and embedded Bash.
