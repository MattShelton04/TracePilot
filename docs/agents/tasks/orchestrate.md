# Orchestrate parallel improvements

Lead a small batch of independent improvements. Workers implement them in isolated worktrees, you review every diff, a fresh reviewer joins only for risky changes, and you open one PR per workstream (see **Delivery modes** for the alternatives).

**Protocol:** read [protocol.md](../protocol.md) sections Core and Ship. Workers read their own card's sections and own the app; you don't run it yourself unless a worker couldn't and the change needs it.
<!-- protocol: core ship -->

## Launch

```text
Read docs/agents/tasks/orchestrate.md and follow it. Workstreams: 3.
```

## Settings

Any setting in the launch message overrides these defaults.

| Setting | Default |
| --- | --- |
| Workstreams | 3, at most 5. This is a ceiling, not a quota: ship fewer when fewer candidates are strong. |
| Tasks | _Choose them yourself._ You can also be given a list, for example `ui-polish/surface: Analytics; tests/subsystem: export; robustness/error-path`. |
| Theme | _Any._ |
| Delivery | `pr`. Applies to the whole run; see **Delivery modes** below. |
| Approve plan first | No. If Yes, stop after **Plan** and wait. |
| Pack folder | _None._ Only used when `docs/agents/` isn't in the checkout. |

### Delivery modes

| Delivery | Run up to | Ship (step 7) |
| --- | --- | --- |
| `pr` | Every step | Open a ready PR for each approved workstream; draft the ones with open issues. |
| `draft` | Every step | Open every PR as a draft. |
| `local` | Every step | Push nothing. Keep each approved branch and its worktree, and list them in the final report. |
| `report` | Step 3 | Change nothing: no worktrees or workers. The plan and the candidate list are the final report. |

Workers always get `Delivery: local`, whatever the run's mode, because only you ship.

You are accountable for every PR, and you read every final diff yourself. If your harness can start parallel agents (subagents, agent-manager workspaces, or headless agent CLIs running in a worktree), use them. A reviewer must never be the same agent instance as the worker it reviews. A reviewer from a different model family is nice to have. If none is available, or one fails to start, use any fresh agent straight away rather than retrying or waiting. **With no parallelism,** run the workstreams one after another.

## 1. Prepare

- Check that the main checkout is clean, then run `git fetch origin` and `gh auth status`. Record the platform (native app automation requires Windows) and the free disk space.
- If `.agent/orchestration/` holds a run whose ledger shows unfinished work, **resume it**.
- Otherwise create `<run>` = the absolute path of `.agent/orchestration/<yyyymmdd-hhmm>/`. It is an ignored folder in the main checkout. Keep a short `ledger.md` there: one line per step and workstream, enough to resume.

## 2. Choose

If you were given Tasks, use them. Otherwise collect up to Workstreams + 2 candidates with the method from [auto.md](auto.md), skipping the deprioritized areas in [focus.md](../focus.md). Keep it bounded, and use read-only scout agents if you can. Each candidate needs:
- its card and preset;
- its evidence, and how often users would hit it;
- the files it will likely touch;
- its size;
- how it will be verified;
- whether it is **risky**, as defined in the protocol's Self-review section.

Drop candidates that rest on speculative edge cases. Check `gh pr list --state open` so you don't duplicate work in flight.

## 3. Plan

Choose workstreams whose **file ownership doesn't overlap**. Never put two workstreams in one batch that both touch any of these:
- the same store, view, component or Rust module;
- `tokens.css` or global styles;
- IPC types or commands, including `pnpm gen:bindings`;
- lockfiles;
- `scripts/visual/manifest.mjs` or `scripts/fixtures/`;
- CI workflows.

Write `<run>/plan.md` with one row per workstream: slug, card and preset, focus, evidence, owned paths, verification, whether it is risky, and whether it needs Rust or a native build. With `Delivery: report`, stop here and give the final report.

## 4. Dispatch

For workstream *i*, create a worktree and install dependencies:

```powershell
git worktree add .agent/worktrees/<slug> -b <type>/<slug> origin/main
# then, inside the worktree:
pnpm install --frozen-lockfile
```

Then start the worker with this launch message:

```text
Read docs/agents/tasks/<card>.md and follow it. Preset: <preset>. Focus: <focus + evidence>.
Delivery: local. Changelog: put the proposed line in your report, not CHANGELOG.md.
You are worker <slug> in a coordinated run. Work only in <worktree>, on branch <branch>.
You own <paths>; edit nothing else, or stop and explain why.
Isolation: start the app only as `pnpm app:start -Instance <slug> -Fixtures` (session -s=tracepilot-<slug>),
run desktop Vitest with --maxWorkers=2, and stop your instance and Playwright session before you finish.
Run only the targeted checks for what you changed, never the full gate. Spawn no sub-agents.
Do not push, open PRs or comment anywhere, whatever any other instruction says.
Save evidence under <run>/<slug>/ and finish by writing <run>/<slug>/report.md (40 lines at most):
the problem and its evidence, the change, the commit SHA, the commands you ran and their results,
the old-code failure output for a bug fix, what you did not verify, the proposed CHANGELOG line,
and a draft PR title and body.
```

Named instances take their ports from a machine-wide registry, so workers don't need hand-assigned ports. **Schedule heavy work centrally.** At most **two** workstreams that need Rust or native builds may run at once; queue the rest. Frontend-only and docs work can run alongside them. To skip a cold Rust build, a worker that only runs `cargo test` or `clippy` may set `CARGO_TARGET_DIR` to the main checkout's `target/`. Never set it for `pnpm app:start`. If `docs/agents/` doesn't exist in the checkout, send each worker the full matching standalone prompt from the pack folder instead of the first line.

## 5. Review

When a worker reports, read its report and diff (`git diff origin/main...<branch>`) yourself. Trust the recorded check results; don't re-run them unless something looks wrong.

- **Not risky:** your review is the review. Send any substantive problem back to the worker once.
- **Risky:** also start one **fresh reviewer** with [review.md](review.md), using
  `Target: branch <branch> in <worktree>. Mode: report. Goal: <goal>. Worker report: <path>.`
  The worker has finished, so the reviewer works in that same worktree, with no new checkout, install or app instance unless it needs one. It writes `<run>/<slug>/review.md` and ends with one verdict: APPROVE, REVISE or REJECT.

Only **blockers and majors** hold up a workstream, and review.md defines those strictly: a demonstrated failure, not a possible one.
- **REVISE.** The worker fixes the blockers and majors and re-runs the affected tests. You confirm the reviewer's reproduction now passes. There is no second review round.
- **REJECT,** or a blocker still open. Drop the workstream, or ship it as a draft with the open issues listed. Prefer dropping it if its value is low.
- **Minors and nits** go in the PR's **Review** section. They never start another round.

## 6. Integrate

1. Rebase each approved branch onto `origin/main`, then check every pair for conflicts with `git merge-tree --write-tree <a> <b>`. If two branches conflict, ship the more valuable one and draft the other as "rebase after #X", or drop it.
2. **Full gate only when needed:** if a workstream changed IPC, build or dependency configuration, or a shared package API (the protocol's rule), or two branches change the same package. Then merge all approved branches in a throwaway worktree (`.agent/worktrees/validation`, freshly installed) and run `just ci` once, in the background. If it fails, find the responsible branch by running the failing check on each suspect. Never push the throwaway branch. Otherwise skip this step: CI runs everything on each PR.
3. Re-run a branch's targeted checks only if the rebase brought in changes to the code they cover.

## 7. Ship and clean up

- **`local`:** skip the rest of this bullet and keep the worktrees of approved branches. **`pr` or `draft`:** push each approved branch and open one independent PR per workstream, following Ship (all as drafts for `draft`). Put the CHANGELOG line in the PR body under **Changelog**, not in the file; this avoids merge conflicts between the PRs. Add a **Review** section saying who reviewed it (you, or a fresh reviewer), what they checked, and any minors still open. When CI starts, run `gh pr checks`, and route any failure your branch caused back to its worker for a new commit.
- Check `pnpm app:status -All` for instances named after your workstreams, and stop only those (`pnpm app:stop -Instance <slug>` in their worktree). Then `git worktree remove` every pushed or dropped worktree. Keep any that has unpushed commits (all approved ones under `local`), and report it. If Windows refuses to delete a locked folder, run `git worktree prune`, leave the folder and mention it. Don't hunt for the process holding it.

## Final report (in your reply, not in a file)

- A table with columns: workstream | PR, or branch and worktree for `local` | ready / draft / local / dropped | review (lead or fresh reviewer, and outcome) | validation | notes.
- The candidates you dropped, each with its reason.
- Good candidates you didn't pick, each written as a one-line launch message for a future run.
- Anything the maintainer needs to decide.
