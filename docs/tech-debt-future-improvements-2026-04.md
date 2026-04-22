# Future Improvements — Identified During Tech-Debt Waves (2026-04)

This document collects **candidate improvements** spotted by sub-agents while
executing the `tech-debt-master-plan-2026-04.md` waves. Items here are
intentionally **not** applied in the current wave — they may be breaking,
out-of-scope, require product input, or warrant dedicated design work.

## How to add an entry

Append a new `###` section under the relevant wave. Keep entries short and
actionable so a future engineer can pick them up.

### Template

```
### w<NN> — <short title>

- **Area**: <file / module / layer>
- **Observation**: <what's suboptimal today>
- **Proposed change**: <what to do>
- **Risk / why deferred**: <breaking? scope? product decision? design?>
- **Effort**: S / M / L
```

---

## Entries

<!-- Sub-agents append below this line, newest wave last. -->

### w75 — SearchPalette Tab focus-trap selector is stale

- **Area**: `apps/desktop/src/components/SearchPalette.vue` (`handlePaletteKeydown`, `case "Tab"`)
- **Observation**: The focus-trap uses `(e.target as HTMLElement).closest(".palette-dialog")` to find the dialog, but the template's root modal element has class `.palette-modal`, not `.palette-dialog`. The closest call therefore always returns `null`, so the `Tab` handler short-circuits and relies on native browser tabbing with no trap — inputs inside the palette can hand focus back to elements behind the backdrop.
- **Proposed change**: Replace the literal with `.palette-modal` (or use the existing `modalRef` directly), and add a small Vitest to assert Tab cycles focus between the input and clear button when a query is present.
- **Risk / why deferred**: Wave 75 is strict zero-behaviour-change decomposition; fixing the trap changes keyboard behaviour. Also the current broken state has existed for many waves without a reported a11y bug, so scope it properly.
- **Effort**: S

### w75 — `useSearchPaletteSearch` leaks raw `results`

- **Area**: `apps/desktop/src/composables/useSearchPaletteSearch.ts`
- **Observation**: The composable returns both `results` (raw ref) and derived `groupedResults` / `flatResults`. Only the derived forms are read by the palette today, but `results` is still exported and `uniqueSessionCount()` reaches into it. This makes the public surface ambiguous — future callers might mutate `results` directly and bypass the generation-id guard in `executeSearch`.
- **Proposed change**: Drop `results` from the returned object; reroute `uniqueSessionCount()` through `flatResults`; mark the internal ref `private` by keeping it inside the closure.
- **Risk / why deferred**: Tiny API change but feels like follow-up polish rather than wave 75 scope; no behaviour change without it.
- **Effort**: S

### w75 — Wizard step shared styles rely on sibling-file convention

- **Area**: `apps/desktop/src/components/wizard/wizard-shared.css`, `wizard-form.css`
- **Observation**: Shared wizard step styles (`.slide`, `.slide-content`, `.btn-accent`, `.spinner`, form fields) were pulled into sibling `.css` files imported via `<style scoped src="...">` so scoping is applied per-child. This works but is the first use of that pattern in `apps/desktop` — future contributors may not recognise why the rules live outside the SFC.
- **Proposed change**: Either convert the shared styles into a proper CSS Module (`*.module.css` + typed import) so class bindings are explicit, OR promote the wizard step buttons/inputs into a small `WizardButton.vue` / `WizardPathInput.vue` reusable pair.
- **Risk / why deferred**: Cosmetic / organisational; neither option avoids duplication better than the current setup and both would touch all five `WizardStep*.vue` components.
- **Effort**: M

### w75 — `SearchPaletteResults` prop surface is bloated

- **Area**: `apps/desktop/src/components/search/SearchPaletteResults.vue`
- **Observation**: The child takes 8 props (`groupedResults`, `flatResults`, `selectedIndex`, `loading`, `hasQuery`, `hasResults`, `searchError`, `query`). Five of those are trivially derivable from the other three inside the child. The wide surface exists only because the composable's computed refs are passed individually rather than as a single object.
- **Proposed change**: Either (a) pass the composable's return value as a single reactive prop, or (b) inject the composable via `provide`/`inject` at the palette root so the results child can consume it directly and the parent keeps only presentation glue.
- **Risk / why deferred**: Refactor worth doing but adds a new provide/inject key or prop-object convention; better tackled alongside the `useSearchPaletteSearch` API cleanup above.
- **Effort**: S

