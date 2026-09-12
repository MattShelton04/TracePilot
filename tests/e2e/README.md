# Desktop E2E

Interactive development uses the [automation skill](../../.github/skills/tracepilot-app-automation/SKILL.md)
and the pinned upstream Playwright CLI. Start the real app with `pnpm app:start`,
attach using the printed command, and use snapshots/clicks/screenshots directly.

Repeatable smoke/performance/media diagnostics remain in `scripts/e2e/`.
See [testing](../../docs/testing.md) for commands and
[automation](../../docs/app-automation.md) for the lifecycle and frontend mode.
Desktop CDP requires Windows + WebView2; this directory is not a Playwright Test project.
