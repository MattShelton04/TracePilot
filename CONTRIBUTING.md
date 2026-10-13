# Contributing to TracePilot

Thank you for your interest in TracePilot!

Currently, TracePilot is a **single-developer passion project** and is **not open to external contributions or pull requests** at this time.

The project is in an early, exploratory phase, and the architecture is evolving rapidly. To maintain focus and velocity, all development is currently handled by the primary author.

### How you can help

While we are not accepting code contributions, you can still help by:
- **Reporting bugs:** If you find something that isn't working as expected, please [open an issue](https://github.com/MattShelton04/TracePilot/issues).
- **Suggesting features:** Have an idea for a new dashboard or tool? Feel free to share it in the issues.
- **Providing feedback:** Let us know how you're using TracePilot and what could be improved.

We appreciate your understanding and support!

### Git hooks

Local hooks are opt-in and come from [lefthook.yml](lefthook.yml).

- Install once per clone with `pnpm install && pnpm hooks:install`. This sets
  `core.hooksPath=scripts/git-hooks`, which every worktree of the clone shares.
- Git resolves that relative path in each worktree, so each one runs its own
  tracked shims with its own `node_modules` lefthook.
- In a worktree without `node_modules`, hooks print
  `WARNING: git <hook> checks SKIPPED` and let the commit or push through. Run
  `pnpm install` in that worktree.
- Don't run `lefthook install`: it refuses while `core.hooksPath` is set, and
  `--reset-hooks-path` would go back to hooks tied to one worktree's install.
- pre-commit checks staged files only. pre-push runs
  [pre-push-checks.mjs](scripts/git-hooks/pre-push-checks.mjs): file sizes,
  rustfmt and typecheck, limited to what the branch changed since `origin/main`.
  CI runs every check in full.
- Skip once with `git commit --no-verify` / `git push --no-verify`, or set
  `LEFTHOOK=0`.
