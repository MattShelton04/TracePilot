# Developer and agent experience

Make one contributor or agent workflow trustworthy, fast or easy to diagnose.

**Presets:**
- `doc` (focused): correct one instruction or command that has drifted.
- `ci` (focused): fix one CI friction point you have evidence for.
- `flaky-test` (focused, needs evidence): make one test deterministic.
- `tooling` (larger): remove one obstacle in setup, the build, tests or the app lifecycle.

**Protocol:** read [protocol.md](../protocol.md) sections Core and Ship. For `tooling` that runs the app, also read Running the app.
<!-- protocol: core app? ship -->

## Launch

```text
Read docs/agents/tasks/dev-experience.md and follow it. Preset: doc.
```

## `doc`

`scripts/check-doc-links.mjs` doesn't check anchors, or paths written inside code spans, so backticked paths and commands drift more than anything else. Docs that get the most use:
- `README.md` (the Development section);
- `AGENTS.md`;
- the testing guide (`docs/testing.md`);
- `docs/app-automation.md`;
- `docs/visual-regression.md`;
- `scripts/README.md`;
- the automation skill;
- `docs/README.md`.

Also check that the `justfile` still matches `package.json` and `ci.yml`.

**Run** the instruction you're correcting wherever it's safe to (anything app-related goes on isolated data). Then fix the canonical doc and any index pointing at it. Don't rewrite whole docs or edit historical ADRs, reports or plans beyond fixing broken links.

## `ci`

How CI works:
- `ci.yml` picks which jobs to run from the PR merge diff (`scripts/ci/classify-changes.mjs`, with contract tests alongside). A single `required` job checks the results.
- The `*-report.yml` workflows are trusted publishers and must stay separate from untrusted PR code.
- Actions are pinned by SHA (`node scripts/check-workflow-actions.mjs`).
- `docs/testing.md` documents how caches are shared and how pinned binaries are updated.

Use run history (`gh run list`, `gh run view <id> --json jobs`) to find one problem: a slow avoidable step, a cache that never hits, a misclassified path, or a confusing failure message. Keep triggers, required-check semantics, least-privilege permissions and the trust split. Never use `pull_request_target` for untrusted code. Claim a speed-up only with comparable timings.

## `flaky-test`

You need evidence first: the same test failing on unrelated commits, or passing on a rerun of the same commit (`gh run view <id> --log-failed`), or a local reproduction under stress, such as repeated runs, shuffled order (`vitest --sequence.shuffle`) or changed worker or thread counts. **If you can't substantiate flakiness, stop and make no change.**

Fix the cause:
- uncontrolled timers or dates;
- shared state;
- unawaited hydration or imports;
- colliding temp directories or ports;
- a wrong readiness condition.

Never skip the test, weaken assertions, add retries, or add sleeps. Report how many runs you did and under what conditions.

## `tooling`

Candidates:
- the first long `app:start` build and its messages;
- running one test quickly;
- how clearly `gen:bindings` explains staleness;
- setting up the visual harness;
- recovering when the fixture generator refuses a root;
- lefthook speed and false positives;
- isolation for parallel worktrees and agents;
- PowerShell 5.1 versus pwsh differences.

Reproduce the friction on a clean worktree, then improve an existing entry point rather than adding a new one. Add `node --test` coverage for non-trivial script logic. Don't add a new task runner, container platform or package manager.

## Done when

One instruction, pipeline step, test or workflow is demonstrably fixed, with exact before and after commands or run evidence.
