# Visual regression and route-level browser testing

TracePilot's visual review is designed for a Tauri application without pretending that a
browser mock proves native integration. It exercises the production Vue route tree and
rendered components, while native filesystem, process, updater, dialog, Git, and window
behaviour remain covered by Rust/unit/native smoke tests.

## Pull-request behaviour

1. Changed paths are mapped to route components.
2. Router, application-shell, shared UI, CSS/design-token, package, or Rust changes select
   every route; unmapped feature changes also conservatively select every route.
3. The base and candidate revisions are installed in separate worktrees.
4. Both are rendered with the same Chromium release, viewport, locale, timezone,
   colour scheme, reduced-motion setting, and deterministic Tauri IPC profile.
5. Candidate routes must expose the stable production route identity, must not render a
   Not Found fallback, must not emit browser errors, and must have no serious/critical Axe
   findings.
6. An HTML before/after/diff review, raw screenshots, logs, and JSON metadata are uploaded.
7. A sticky PR comment links to the artifact where repository permissions permit it.

No screenshot from `docs/images` or any pre-existing marketing asset is used as fallback.
A browser/server failure makes the job fail.

## Local commands

```bash
pnpm routes:check
pnpm visual:scope -- --base origin/main --head HEAD
pnpm visual:capture
pnpm visual:capture:mobile
pnpm visual:storyboard
```

## Security boundary

The workflow uses `pull_request`, not `pull_request_target`, so code from a fork is never
executed with a privileged repository token. PR commenting is attempted only for branches
inside the same repository and is non-blocking; artifact creation and test results remain
the source of truth.
