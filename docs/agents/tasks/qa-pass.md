# Exploratory QA pass

Use the app like a tester on synthetic data, then fix the most valuable cluster of related problems you find.

**Size:** larger. **When:** occasionally, for example before a release. **Protocol:** read [protocol.md](../protocol.md) sections Core, UI, Running the app, and Ship.
<!-- protocol: core ui app ship -->

## Launch

```text
Read docs/agents/tasks/qa-pass.md and follow it. Focus: the orchestration pages.
```

## Explore (about 30% of the effort)

1. **Setup.** On Windows, generate the fixtures and run the native app on them (see *Running the app*), and turn auto-attach off. Use `pnpm app:ui` for mock-backed states that are rich in data. Read `docs/reports/usability-audit-2026-09-12/findings.md` and `design-system/audit/` so you don't re-report known issues.
2. **Smoke pass.** Visit every sidebar route, and the session-detail tabs of one gallery session, **at 1440×960 in the dark theme only**. On each, check that it renders, that its primary action works, and that `console error` is clean. Note anything broken or misleading.
3. **Deep pass on one area.** Choose the riskiest area from the smoke pass, or the area named in Focus. There, apply the full matrix:
   - 960×640 and 2560×1440;
   - the light theme;
   - the sidebar collapsed;
   - empty, loading and error states;
   - long content;
   - keyboard only;
   - rapid repeated actions;
   - navigating away mid-load.

   Stay within the safety rules, and never launch, attach to or stop real Copilot sessions.
4. **Log findings** in the ignored `.agent/qa/findings.md`. Give each one an ID, the surface, the viewport and theme, the steps, expected versus actual, a severity, and a screenshot path. Severity is P1 (broken or misleading), P2 (friction) or P3 (polish).

## Fix (the rest)

1. Choose **one cluster** of 1–4 findings that share a surface or a root cause. Rank clusters by severity times how many users they reach.
2. Fix them at the root, with regression tests and matching before/after evidence. Then re-walk the affected area.
3. In the PR, describe the fixed findings with their reproduction steps and evidence. Under **Other findings (not fixed)**, list the rest as one-line items with their severity and steps. Don't commit the findings file.

## Done when

One coherent cluster of reproduced problems is fixed with evidence, and the remaining findings are handed over in a form someone can reproduce.
