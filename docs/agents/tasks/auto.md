# Pick and ship the best improvement

Find the single most valuable improvement you can verify, and ship it as one PR, without being given a target.

**Size:** small to medium. **Protocol:** read [protocol.md](../protocol.md) sections Core and Ship, plus the sections that match the change you choose (UI, Running the app, Rust and IPC).
<!-- protocol: core ui? app? rust? ship -->

## Launch

```text
Read docs/agents/tasks/auto.md and follow it.
```

## Choose (bounded)

Spend about 15% of your effort choosing. Stop as soon as you have one strong candidate. You don't need to tour the whole app.

Pick **one or two** of these sources and look for evidence:
- **Open issues** (`gh issue list --state open --limit 30`). A clear reproduction makes for a strong candidate.
- **Recent churn** (`git log --since=30.days --stat origin/main`). Look for complex logic in heavily changed areas that has thin tests. Parsing for new Copilot CLI versions, accounting and metrics, live sessions and renderers have all changed recently.
- **CI history** (`gh run list --workflow ci.yml --status failure --limit 20`). Look for failures that keep recurring.
- **A short smoke pass of the app** at 1440×960 on synthetic data, covering only the main routes. See *Running the app*.
- **Quality pressure.** Look for files at their size budget, rules duplicated between Rust and TypeScript, and stale commands in the docs.

When choosing, prefer in this order:
1. A reproduced bug.
2. A misleading number or state.
3. Missing coverage on risky logic.
4. A UI friction point.
5. A maintainability problem.

Once you've chosen, follow the matching [task card](./) for standards. The [playbook](../README.md) maps types of change to cards. Explain your choice in the PR's "Why this" section.

## Shape

Make one coherent PR, typically under about 400 changed lines, not counting tests and fixtures. If the best candidate is bigger, ship its most valuable self-contained slice and list the rest as follow-ups. Don't bundle unrelated fixes, and don't hand back a backlog instead of a change.
