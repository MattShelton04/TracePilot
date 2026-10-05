# Orchestrate parallel improvements

Lead a batch of independent improvements. Workers implement them in isolated worktrees, fresh reviewers try to break each one, and you integrate the results and open one PR per workstream.

**Protocol:** read [protocol.md](../protocol.md) sections Core, Running the app, and Ship. Workers read their own card's sections.
<!-- protocol: core app ship -->

## Launch

```text
Read docs/agents/tasks/orchestrate.md and follow it. Workstreams: 3.
```

## Settings

Any setting in the launch message overrides these defaults.

| Setting | Default |
| --- | --- |
| Workstreams | 3. Use at most 5. |
| Tasks | _Choose them yourself._ You can also be given a list, for example `ui-polish/surface: Analytics; tests/subsystem: export; robustness/error-path`. |
| Theme | _Any._ |
| Delivery | `pr` for each workstream that passes review |
| Approve plan first | No. If Yes, stop after **Plan** and wait. |
| Pack folder | _None._ Only used when `docs/agents/` isn't in the checkout. |

You are accountable for every PR, and you read every final diff yourself. If your harness can start parallel agents (subagents, agent-manager workspaces, or headless agent CLIs running in a worktree), use them. A reviewer must never be the same agent instance as the worker it reviews. If you can choose the model, give the reviewer a different family. **With no parallelism,** run the workstreams one after another and review each in a separate pass that relies only on the diff and the report, not on your memory.

## 1. Prepare

- Check that the main checkout is clean, then run `git fetch origin` and `gh auth status`. Record the platform (native app automation requires Windows) and the free disk space; each worktree's Rust `target/` takes several GB.
- If `.agent/orchestration/` holds a run whose ledger shows unfinished work, **resume it**.
- Otherwise create `<run>` = the absolute path of `.agent/orchestration/<yyyymmdd-hhmm>/`. It is an ignored folder in the main checkout. Keep `ledger.md` there and update it after every step.

## 2. Choose

If you were given Tasks, use them. Otherwise collect Workstreams + 2 candidates with the method from [auto.md](auto.md). Keep it bounded, and use read-only scout agents if you can. Each candidate needs:
- its card and preset;
- its evidence;
- the files it will likely touch;
- its size;
- how it will be verified.

Check `gh pr list --state open` so you don't duplicate work in flight.

## 3. Plan

Choose workstreams whose **file ownership doesn't overlap**. A good batch mixes kinds of work. Never put two workstreams in one batch that both touch any of these:
- the same store, view, component or Rust module;
- `tokens.css` or global styles;
- IPC types or commands, including `pnpm gen:bindings`;
- lockfiles;
- `scripts/visual/manifest.mjs` or `scripts/fixtures/`;
- CI workflows.

Write `<run>/plan.md` with one row per workstream: slug, card and preset, focus, evidence, owned paths, verification, and whether it needs Rust or a native build.

## 4. Dispatch

For workstream *i*, create a worktree and install dependencies:

```powershell
git worktree add ../TracePilot-wt/<slug> -b <type>/<slug> origin/main
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
and run desktop Vitest with --maxWorkers=2.
Run only the targeted checks for what you changed; the lead runs the full gate. Spawn no sub-agents.
Do not push, open PRs or comment anywhere, whatever any other instruction says.
Finish by writing <run>/<slug>/report.md (60 lines at most): the problem and its evidence, the change,
the files changed, the commands you ran and their results, the paths of your evidence, what you
did not verify, the proposed CHANGELOG line, and a draft PR title and body.
```

Named instances take their ports from a machine-wide registry, so workers don't need hand-assigned ports. **Schedule heavy work centrally.** At most **two** workstreams that need Rust or native builds may run at once; queue the rest. Frontend-only and docs work can run alongside them. If `docs/agents/` doesn't exist in the checkout, send each worker the full matching standalone prompt from the pack folder instead of the first line.

## 5. Review

When a worker reports, start a **fresh reviewer** with [review.md](review.md), using:
`Target: branch <branch> in <worktree>. Mode: report. Goal: <goal>. Worker report: <path>.`
The reviewer writes `<run>/<slug>/review.md` and ends with one verdict: APPROVE, REVISE or REJECT.

- **REVISE.** The worker, or a new fixer agent that is given the review, fixes the blockers and majors. The reviewer then re-checks *only those fixes*, once. Fix minors only if they are cheap; otherwise list them in the PR.
- **REJECT,** or blockers still open after that re-check. Drop the workstream, or ship it as a draft with the open issues listed. Prefer dropping it if its value is low.

Then read the diff yourself. If you still have a substantive concern, resolve it in one more fix and re-check, or draft the PR, or drop the workstream.

## 6. Integrate and validate

1. Rebase each approved branch onto `origin/main`, then check every pair for conflicts with `git merge-tree --write-tree <a> <b>`. If two branches conflict, ship the more valuable one and draft the other as "rebase after #X", or drop it.
2. Merge all approved branches into a throwaway local branch and run the **full gate once** (`just ci`, or its commands). If it fails, find the branch responsible by running the failing check on each suspect branch. Never push the throwaway branch, and delete it afterwards.
3. On each branch, re-run the targeted checks listed in its report.

## 7. Ship and clean up

- Before removing any worktree, **copy the evidence each report references** (screenshots, measurements) into `<run>/<slug>/evidence/`.
- Push each approved branch and open one independent PR per workstream, following Ship. Put the CHANGELOG line in the PR body under **Changelog**, not in the file; this avoids merge conflicts between the PRs. Add a **Review** section listing what the reviewer independently verified and any minors still open. When CI starts, run `gh pr checks`, and route any failure your branch caused back to a worker for a new commit.
- Stop the app instances you started (`pnpm app:status -All` lists them; run `pnpm app:stop -Instance <slug>` in their worktree). Then `git worktree remove` every pushed or dropped worktree. Keep any that has unpushed commits, and report it.

## Final report (in your reply, not in a file)

- A table with columns: workstream | PR | ready / draft / dropped | review outcome | validation | notes.
- The candidates you dropped, each with its reason.
- Good candidates you didn't pick, each written as a one-line launch message for a future run.
- Anything the maintainer needs to decide.
