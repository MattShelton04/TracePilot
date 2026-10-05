# Agent task playbook

These are reusable task cards for autonomous coding agents (Claude Code, Codex, Antigravity, Copilot CLI, or any agent that can read files and run a shell). Each card turns a short launch message into one evidence-backed PR, or into an honest "nothing worth changing". The shared rules, such as branching, data safety, verification and PR format, are in [protocol.md](protocol.md). Each card reads only the protocol sections it needs.

## Launching a card

Every launch is a one-line message to an agent started at the repository root:

```text
Read docs/agents/tasks/<card>.md and follow it. [Preset: <preset>.] [Focus: <area>.] [Delivery: pr|draft|local|report.]
```

You can leave out Preset and Focus, and the agent will choose using evidence. It skips the deprioritized areas listed in [focus.md](focus.md); see *Steering what agents work on* below. Use `Delivery: report` to get findings without any code changes, which is a cheap way to scout. Use `local` to review the result before anything is pushed.

## Cards

| Card | Presets | Use it when… | Typical cadence |
| --- | --- | --- | --- |
| [auto](tasks/auto.md) | – | You have spare capacity and no particular target. | Any time |
| [ux-behavior](tasks/ux-behavior.md) | `states`, `keyboard`, `form`, `collection` | A screen misleads, traps or frustrates users. | Regular |
| [ui-polish](tasks/ui-polish.md) | `component`, `layout-stress`, `surface` | Something looks unfinished or breaks at 960×640. | Regular |
| [async-lifecycle](tasks/async-lifecycle.md) | `stale-result`, `resource-cleanup` | You suspect stale data after fast navigation, or a leak. | Regular |
| [robustness](tasks/robustness.md) | `error-path`, `ipc-contract` | A failure shows a raw or misleading message, or Rust and TS shapes drift. | Regular |
| [metric-consistency](tasks/metric-consistency.md) | – | Tokens, credits or counts differ between views. | Regular |
| [tool-renderer](tasks/tool-renderer.md) | – | A Copilot tool renders poorly or not at all. | Regular |
| [tests](tasks/tests.md) | `regression`, `subsystem` | Risky logic is under-tested. | Regular |
| [maintainability](tasks/maintainability.md) | `function`, `duplicated-rule`, `hotspot`, `dead-code` | Code is hard to change, near its size budget, or left over from a migration. | Regular; use `dead-code` only when triggered |
| [workflow-hardening](tasks/workflow-hardening.md) | – | An end-to-end flow (setup, refresh, import, settings) needs to be solid. | Monthly |
| [performance](tasks/performance.md) | – | Something feels slow. The agent measures before and after. | When noticed |
| [qa-pass](tasks/qa-pass.md) | – | You want an agent to test the app like a person would, then fix the worst cluster of problems. | Before releases |
| [cli-compat](tasks/cli-compat.md) | – | A new Copilot CLI version has shipped, or parsing complaints come in. | On each CLI release |
| [trust-boundary](tasks/trust-boundary.md) | – | A security-minded pass is due on one input boundary. | Quarterly, or after boundary changes |
| [dev-experience](tasks/dev-experience.md) | `doc`, `ci`, `flaky-test`, `tooling` | Docs drift, CI hurts, a test is flaky, or setup is painful. | When noticed; use `flaky-test` only with evidence |
| [orchestrate](tasks/orchestrate.md) | – | You want several PRs from one hands-off run. | Weekly batch |
| [review](tasks/review.md) | modes `report`, `comment`, `fix` | You want a second opinion on a PR, ideally from a different model. | After each agent PR |

Focused presets produce small PRs. Larger presets (`hotspot`, `surface`, `subsystem`, `tooling`, `dead-code`, and the workflow-hardening, performance, qa-pass, cli-compat and trust-boundary cards) explore and verify more. Every card runs the checks that match its change, and runs the full gate only for IPC, build, dependency or shared-package API changes.

## Playbooks

### Hands-off: let an orchestrator run a batch

1. Start one agent at the repository root on a clean `main`, with permission to use `git`, `gh`, `pnpm`, `cargo` and `node`:
   ```text
   Read docs/agents/tasks/orchestrate.md and follow it. Workstreams: 3.
   ```
   Add `Approve plan first: Yes` the first few times, so you can see what it picks before any code is written. Add `Theme: …` or `Tasks: …` to steer it.
2. The lead then works through these steps:
   1. Chooses candidates backed by evidence.
   2. Plans workstreams that don't touch the same files.
   3. Runs workers in isolated worktrees under `.agent/worktrees/`, each with a named app instance (`-Instance`) that has its own ports and synthetic data.
   4. Reviews every diff itself, and adds one fresh reviewer only for risky changes (concurrency, deletion, trust boundaries, migrations, IPC, widely shared code). Only demonstrated failures block a workstream.
   5. Runs the full gate on the merged work only when a workstream needs it; otherwise CI covers it.
   6. Opens one PR per workstream, each with a **Review** and a **Changelog** section.
3. Afterwards, you:
   - Read the final report.
   - Optionally run `review` with a *different* model on each PR (`Target: #N`, default `report` mode).
   - Merge in any order. Then add the CHANGELOG lines from the PR bodies, or ask an agent to.
4. If a run is interrupted, launch the same message again. The lead resumes from its ledger in `.agent/orchestration/`.

The orchestrator can't merge, release or touch your real Copilot data, and every PR it opens is independent of the others.

### Quick win

Run `auto`, or a regular card with a Focus. One agent, one small PR.

### Second opinion on any PR

Run `Read docs/agents/tasks/review.md and follow it. Target: #N.` It reports in chat and publishes nothing. Add `Mode: comment` or `Mode: fix` when you want it to act. This works best when the reviewer is a different model from the PR's author.

### Event-driven runs

| Event | Card |
| --- | --- |
| New Copilot CLI release | `cli-compat` |
| Recurring CI failure | `dev-experience` with `Preset: flaky-test` or `ci` |
| Before a release | `qa-pass`, then `workflow-hardening` on whatever it finds |
| After a migration lands | `maintainability` with `Preset: dead-code` |

## Steering what agents work on

[focus.md](focus.md) lists what to prefer and which experimental areas (Replay, MCP servers and others) to leave alone. Agents never pick a target there, though a broad change can still touch those areas as far as it needs to. Edit the list when priorities change. To target a deprioritized area on purpose, name it in the launch message.

## Keeping runs proportionate

- **Every card can end in a no-change outcome.** Discovery is bounded (about 15–25% of the effort), and spare capacity goes to verification rather than extra scope.
- **Checks match the change.** Work runs the checks for the paths it changed. The full gate (about 15 minutes) runs only for IPC, build, dependency or shared-package API changes, because CI runs everything on the PR anyway.
- **Each check runs once.** Whoever runs a check records the commit and result, and later steps reuse it unless the code changes. "Prove the test fails on the old code" is done once, for bug fixes and regression tests only.
- **Review is proportional.** A fresh-context reviewer is used only for risky changes, and only a demonstrated failure blocks. Speculative concerns and cleanups go in the PR as follow-ups.
- **Prefer what users hit.** A reproduced problem in an everyday workflow beats a hardened edge case. `Workstreams` is a ceiling, not a quota.
- **To spend less,** use `Delivery: report` for a findings-only pass, choose focused presets, or lower `Workstreams`.

## Harness notes

- **Any harness:** the one-line launch message above works wherever the agent can read files. Nothing else is required.
- **Claude Code:** O1-style parallel runs map onto its subagents and worktree isolation. If you want slash commands, a thin `.claude/commands/<card>.md` containing only the launch line is enough.
- **Codex:** it reads `AGENTS.md`. Codex cloud runs on Linux, so native app automation is unavailable there. The cards fall back to the visual harness and crate-scoped tests, and say so in the PR. Prefer non-UI cards in the cloud.
- **Antigravity:** you can run `orchestrate` as a lead agent, or dispatch individual cards to separate agents, each in its own worktree. Its default workspace folder `.agent/` is already ignored here as scratch space, so don't keep agent configuration there.

## Maintaining the cards

- These docs follow the repository's documentation rules. Links are checked by `node scripts/check-doc-links.mjs`, and lasting changes belong here rather than in dated reports.
- When a command, path or convention changes, update the card or the protocol section that mentions it. Agents report drift they encounter in their handovers.
- Facts quoted in cards, such as fixture counts, size budgets and PR numbers, are examples, not contracts. Agents are told to trust the repository over the card.
