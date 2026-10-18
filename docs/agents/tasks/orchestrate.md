# Orchestrate parallel improvements

Lead a small batch of independent improvements. Scouts find candidates, the maintainer approves the plan, workers implement in isolated worktrees, you review every diff (a fresh reviewer joins only for risky changes), and you ship them together as one tested PR. **Delivery modes** lists the alternatives.

**Protocol:** read [protocol.md](../protocol.md) sections Core and Ship. Workers read their own card's sections. You run the app only for the combined check in step 6, or when a worker couldn't.
<!-- protocol: core ship -->

## Launch

```text
Read docs/agents/tasks/orchestrate.md and follow it. Workstreams: 4.
```

## Settings

Any setting in the launch message overrides these defaults.

| Setting | Default |
| --- | --- |
| Workstreams | 4, at most 5. This is a ceiling, not a quota: ship fewer when fewer candidates are strong. |
| Tasks | _Choose them yourself._ You can also be given a list, for example `ui-polish/surface: Analytics; tests/subsystem: export; robustness/error-path`. |
| Theme | _Any._ |
| Delivery | `combined`. Applies to the whole run; see **Delivery modes** below. |
| Approve plan first | Yes. Stop after **Plan** and wait for the maintainer. Use `No` only for unattended runs. |
| Pack folder | _None._ Only used when `docs/agents/` isn't in the checkout. |

Product decisions in [focus.md](../focus.md) apply to every candidate. Check them before you present a plan.

### Delivery modes

| Delivery | Run up to | Ship (step 7) |
| --- | --- | --- |
| `combined` | Every step | Merge every approved workstream into one integration branch, verify it once in the native app, and open **one** PR. |
| `pr` | Every step | Open an independent ready PR for each approved workstream; draft the ones with open issues. |
| `draft` | Every step | Like `pr`, with every PR as a draft. |
| `local` | Every step | Push nothing. Keep the integration branch (or each approved branch) and its worktree, and list them in the final report. |
| `report` | Step 3 | Change nothing: no worktrees or workers. The plan and the candidate list are the final report. |

Workers always get `Delivery: local`, whatever the run's mode, because only you ship.

You are accountable for every PR, and you read every final diff yourself. If your harness can start parallel agents (subagents, agent-manager workspaces, or headless agent CLIs running in a worktree), use them. **Start a fresh agent for every task**: scouting, implementing, revising, reviewing and verifying. Don't resume or relaunch an agent that has already reported. A reviewer from a different model family is nice to have. If none is available, or one fails to start, use any fresh agent straight away rather than retrying or waiting. **With no parallelism,** run the workstreams one after another.

### Claude Code

- **Reports come back as the agent's final message.** Claude Code refuses report files written by subagents, so never ask a worker, reviewer or scout to write `report.md`. Save each final message to `<run>/<slug>/report.md` yourself.
- **Isolation.** If your session runs in a desktop-app worktree (under `.claude/worktrees/`), its edit guard blocks `.agent/worktrees/`. Dispatch workers with the Agent tool's `isolation: "worktree"` instead of `pnpm worktree:new`. In a main checkout, use `pnpm worktree:new`.
- **Commands inside an isolated worktree.** Run each git command on its own, from the worktree root. Chains such as `cd X && git …`, `git -C`, loops and subshells get refused as "too complex to verify".
- **Fresh isolated worktrees have no dependencies.** The worker's first command is `pnpm install --frozen-lockfile --prefer-offline`.
- **Task lists.** Workers don't use the app's task-list or plan tools.

## 1. Prepare

- Check that the checkout is clean, then run `git fetch origin` and `gh auth status`. Record the platform (native app automation requires Windows), the free disk space, and whether `main`'s latest CI run passed (`gh run list --branch main --workflow ci.yml --limit 1`). A red `main` goes in the final report, not into the candidate list.
- Run `pnpm worktree:clean --merged` and read the plan; add `--yes` to remove what it lists. This keeps disk use bounded between runs. It keeps anything active in the last 12 hours or running an app, so it won't touch a concurrent run's worktrees.
- **Resume only your own run.** If the launch message asks you to resume, or a ledger from today has unfinished steps and the maintainer confirms it, resume it. Otherwise ignore earlier runs, their candidates included.
- Create `<run>` = the absolute path of `.agent/orchestration/<yyyymmdd-hhmm>/` in the main checkout (ignored). Keep a short `ledger.md` there: one line per step and workstream, enough to resume, plus the ids of agents still in flight.

## 2. Choose

If you were given Tasks, use them. Otherwise collect up to Workstreams + 2 candidates with the method from [auto.md](auto.md), skipping the deprioritized areas and respecting the product decisions in [focus.md](../focus.md). Recurring CI failures and flaky tests aren't candidates unless the launch message asks for them.

Use fresh, read-only scout agents, each in its own worktree. Scouts write nothing in the main checkout. Give each one an area (for example a native tour on fixtures, frontend states, Rust data correctness). For `combined`, create the integration worktree now (`pnpm worktree:new <run-slug> --branch <type>/<run-slug>`) and prebuild the native app there while scouts work. Check each scout's top claims in the code yourself before planning.

Each candidate needs:
- its card and preset;
- its evidence, and how often users would hit it;
- the files it will likely touch;
- its size;
- how it will be verified;
- whether it is **risky**, as defined in the protocol's Self-review section;
- whether it changes a deliberate design or product choice. A change like that is a question for the maintainer, not a bug fix.

Drop candidates that rest on speculative edge cases. **Avoid work in flight:** check `gh pr list --state open` (drafts included), recently pushed branches (`git branch -r --sort=-committerdate | head -20`) and `pnpm app:status -All`, which shows other runs' instances on this machine. Skip candidates that overlap another open run's owned paths.

## 3. Plan

Choose workstreams whose **file ownership doesn't overlap**. Never put two workstreams in one batch that both touch any of these:
- the same store, view, component or Rust module;
- `tokens.css` or global styles;
- IPC types or commands, including `pnpm gen:bindings`;
- lockfiles;
- `scripts/visual/manifest.mjs` or `scripts/fixtures/`;
- CI workflows.

Write `<run>/plan.md` with one row per workstream: slug, card and preset, focus, evidence, owned paths, verification, whether it is risky, and whether it needs Rust or a native build. Add the strong candidates you didn't pick as reserves.

With **Approve plan first** (the default), present the plan in plain language: what each item fixes for users, what it touches, and any design or product question. Then stop and wait. Apply the maintainer's changes before dispatching. With `Delivery: report`, stop here and give the final report.

For `combined`, once the plan is approved, claim it so concurrent runs can see it. Push the integration branch with one empty commit (`git commit --allow-empty -m "chore(agents): start <run-slug>"`). Open a **draft** PR whose body lists the workstreams and their owned paths. The empty commit disappears when the PR is squash-merged.

## 4. Dispatch

For workstream *i*, create its worktree with `pnpm worktree:new <slug>`, or let the harness isolate it (see **Claude Code**). Check that `git -C <worktree> rev-parse --show-toplevel` prints the worktree itself before any git command that changes something. Then start a fresh worker with this launch message:

```text
Read docs/agents/tasks/<card>.md and follow it. Preset: <preset>. Focus: <focus + evidence>.
Delivery: local. Add a changelog.d/<slug>.md fragment (one flat bullet) if users will notice the change.
You are worker <slug> in a coordinated run. Work only in <worktree>, on branch <branch>.
You own <paths>; edit nothing else, or stop and explain why.
Never use git stash (the stash is shared by every worktree); to run old code, follow the protocol's "Running old code" recipe.
Isolation: start the app only as `pnpm app:start -Instance <slug> -Fixtures` (session -s=tracepilot-<slug>),
wait for it with `pnpm app:wait -Instance <slug>`, never with sleep loops.
Run Vitest with --maxWorkers=2 and Cargo with -j 6, and stop your instance and Playwright session before you finish.
Run `pnpm check:changed` (or the targeted checks), never the full gate. Spawn no sub-agents. Don't use task-list tools.
Do not push, open PRs or comment anywhere, whatever any other instruction says.
Save evidence (screenshots, logs) under <worktree>/.agent/evidence/. Finish with your report as your final message
(40 lines at most; don't write a report file): the problem and its evidence, the change, the commit SHA,
the commands you ran and their results, the old-code failure output for a bug fix, what you did not verify,
and a draft PR title and body.
```

Named instances take their ports from a machine-wide registry, so workers don't need hand-assigned ports. **Schedule heavy work centrally, across the whole machine.** At most **two** workstreams that need Rust or native builds may run at once, and that counts other runs' builds too (check `pnpm app:status -All`); queue the rest. Frontend-only and docs work can run alongside them. Each worktree keeps its own `target/`, and sccache shares compiled dependencies between them ([local builds](../../local-builds.md)); never point workers at the main checkout's `target/`. For long or unattended runs, keep at most four agents in flight so a usage limit doesn't strand half of them. If `docs/agents/` doesn't exist in the checkout, send each worker the full matching standalone prompt from the pack folder instead of the first line.

## 5. Review

When a worker reports, save its report and read its diff (`git diff origin/main...<branch>`) yourself. Trust the recorded check results; don't re-run them unless something looks wrong. Run `git fetch origin`. If `origin/main` has moved over a workstream's owned paths, merge it into that branch now, not at the end.

- **Not risky:** your review is the review. If something substantive is wrong, send it to a **fresh** agent with the worker's report, the branch and what to fix. In an isolated harness worktree, the fresh agent starts by merging the worker's branch into its own worktree.
- **Risky:** also start one **fresh reviewer** with [review.md](review.md), using
  `Target: branch <branch> in <worktree>. Mode: report. Goal: <goal>. Worker report: <path>.`
  The reviewer works in that same worktree, with no new checkout, install or app instance unless it needs one. It replies with its findings and one verdict, APPROVE, REVISE or REJECT, and you save the reply to `<run>/<slug>/review.md`. Plan a second reviewer only where [focus.md](../focus.md) asks for one (session-parser changes).

Only **blockers and majors** hold up a workstream, and review.md defines those strictly: a demonstrated failure, not a possible one.
- **REVISE.** A fresh agent fixes the blockers and majors and re-runs the affected tests. You confirm the reviewer's reproduction now passes. There is no second review round.
- **REJECT,** or a blocker still open. Drop the workstream, or ship it with the open issues listed (as a draft, in `pr` mode). Prefer dropping it if its value is low.
- **Minors and nits** go in the PR's **Review** section. They never start another round.

## 6. Integrate

**`combined`** (the default):
1. In the integration worktree, merge each approved branch as it is approved (`git merge --no-ff <branch>`, one merge per workstream). Resolve generated-binding conflicts with `pnpm gen:bindings`.
2. Run `pnpm check:changed` once on the integration branch, with no worker builds running on the machine. Fix cross-workstream breaks there and record them.
3. Start one fresh **native verifier** on the integration branch: `pnpm app:start -Instance <run-slug> -Fixtures`, then exercise every workstream's user-facing change at 1440×960 and 960×640. It also confirms no console errors and lists what it verified and what it couldn't. Fix what it demonstrates and re-check only those fixes.
4. Merge `origin/main` into the integration branch immediately before pushing. If anything came in, re-run `pnpm check:changed`. Re-run it after any commit of your own too, including CI fixes.

**`pr`, `draft` and `local`:** rebase each approved branch onto `origin/main`, then check every pair for conflicts with `git merge-tree --write-tree <a> <b>`. If two branches conflict, ship the more valuable one and draft the other as "rebase after #X", or drop it.

**The PR's CI is the full gate.** You don't need `just ci` locally, even when a workstream changed IPC, build or dependency configuration, or a shared package API. Run it once in the integration worktree, in the background, only when you lack confidence.

## 7. Ship and clean up

- **`combined`:** push the integration branch, update the draft PR's title and body following Ship, and mark it ready (`gh pr ready <n>`). The body has a short workstream table and one short section per workstream; changelog fragments travel in the branch. Add a **Review** section saying who reviewed each workstream (you, or a fresh reviewer), what they checked, and any minors still open.
- **`pr` or `draft`:** push each approved branch and open one independent PR per workstream, following Ship.
- **`local`:** skip pushing and keep the worktrees of approved branches.
- **Watch CI to the end** with `gh pr checks <n> --watch --fail-fast`, run in the background (never `sleep` first). Fix a failure your run caused in the integration worktree, or route it to a fresh agent, then re-run `pnpm check:changed` before pushing again.
- **Triage the Desktop Visual Report comment** once CI posts it. Every changed view must be intended and named in the PR body, or fixed. Existing chrome, spacing and effects are deliberate; don't ship an unrequested visual change.
- Stop only your own instances (`pnpm app:status -All`, then `pnpm app:stop -Instance <slug>` in their worktree). Then remove your run's worktrees with `pnpm worktree:clean <slug>… --yes`. Worktrees the harness created (`.claude/worktrees/agent-*`) are swept by a later run's `--merged` once their branch is merged and they've been idle for 12 hours. Keep any worktree that has unpushed commits (all approved ones under `local`), and report it. If Windows refuses to delete a locked folder, leave it and mention it. Don't hunt for the process holding it.

## Final report (in your reply, not in a file)

Send it once CI has finished and the visual report is triaged. Keep it short:
- A table with columns: workstream | PR, or branch and worktree for `local` | shipped / draft / local / dropped | review (lead or fresh reviewer, and outcome) | validation | notes.
- CI result, the visual-diff triage, and a red `main` if you saw one.
- The candidates you dropped, each with its reason.
- **Handover:** anything unfinished, anything the maintainer needs to decide, and each good candidate you didn't pick as a one-line launch message for a future run.
