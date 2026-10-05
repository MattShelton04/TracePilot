# Visual polish

Make the UI look as finished as its best parts, inside the design system, without a redesign.

**Presets:**
- `component` (focused, the default): one dialog, toolbar, header, card, row or settings section.
- `layout-stress` (focused): fix overflow or clipping caused by realistic awkward data or the minimum window size.
- `surface` (larger): one page or session-detail tab.

**Protocol:** read [protocol.md](../protocol.md) sections Core, UI, Running the app, and Ship.
<!-- protocol: core ui app ship -->

## Launch

```text
Read docs/agents/tasks/ui-polish.md and follow it. Preset: surface. Focus: Analytics dashboard, light theme.
```

## Rules for every preset

- Capture "before" evidence, then make the change, then capture "after" evidence of the same state. Check the light theme with `app:ui` or the native app, because the harness captures dark only.
- Typical fixes:
  - spacing on the 4px grid;
  - alignment and baselines;
  - type scale, with monospace for IDs, values and timings;
  - control and icon sizes;
  - hairline separators;
  - grouping of actions;
  - hover, focus and disabled states.

  Decide what actually needs attention instead of applying every item.
- Don't add new fonts, colours, gradients, decorative shadows or cards, or animation systems. Don't make app-wide token changes, enlarge headings, or regenerate README screenshots. Never hide useful information to make a screenshot look cleaner.
- Read `docs/reports/usability-audit-2026-09-12/findings.md` first so you don't redo fixes that are already done.

## Presets

### `component`
Compare the component with a well-finished neighbor, such as the session header, `PageHeader` or `SegmentedControl`. If the component is shared, check a sample of its consumers.

### `layout-stress`
Use realistic awkward data:
- long repository, branch and worktree names;
- deep Windows paths;
- session titles that are whole prompts;
- long model names;
- wide SQL tables;
- many agents or todos;
- CJK text or emoji in *content*.

Check at 960×640 with the sidebar expanded and collapsed. Fix the problem locally, for example with `min-width: 0`, wrapping, deliberate truncation where the full value stays reachable, or scroll regions. Never use `overflow: hidden` just to hide the symptom.

### `surface`
List the 3–6 most important problems you see on the surface, and fix them as one cohesive set. Check at all three viewports, in both themes, and in the states that matter: populated, empty, loading, error, and long content. Look in `design-system/audit/` for issues that are already known.

## Done when

The improvement is visible, fits the app, and is shown by matching before/after screenshots, and your files pass `pnpm check:design-system`. If you couldn't inspect the result at runtime, keep the change narrow and use a draft PR.
