# Implementation Plan 5: Accessibility (Workstream E)

**Priority**: Tier 2 — HIGH IMPORTANCE (WCAG AA minimum)  
**Estimated Scope**: ~150 lines of changes across ~20 files  
**Dependencies**: None

---

## E1: Add Focus Trap to ModalDialog

### Approach

Use a minimal custom focus trap (zero dependencies, sufficient for ModalDialog).

**File**: `packages/ui/src/components/ModalDialog.vue`

> **Teleport note**: ModalDialog uses `<Teleport to="body">`, so the focus trap must
> target the teleported DOM element via `overlayRef`. Any watcher that activates the
> trap on open should use `{ flush: 'post' }` to ensure the DOM has been updated after
> teleport before activating.

> **ConfirmDialog note**: `ConfirmDialog.vue` already has partial focus management
> (it focuses the cancel button on open). Ensure the ModalDialog-level trap does not
> conflict — e.g. the trap should not override ConfirmDialog's explicit `focus()` call
> if it fires after the trap's initial focus.

### Recommended: Minimal custom focus trap

```ts
function trapFocus(container: HTMLElement) {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  container.addEventListener('keydown', handleKeydown);
  first?.focus();
  return () => container.removeEventListener('keydown', handleKeydown);
}
```

### Also add:
- **Focus restoration**: Save `document.activeElement` before open, restore on close
- **Escape key**: Already handled via `close()` — verify it works

> **Future Enhancement — VueUse focus trap**: If a more robust focus trap is needed
> later (e.g. nested modals, multiple trap zones), consider `@vueuse/integrations/useFocusTrap`.
> This is **not currently in the dependency tree** and requires:
> ```bash
> pnpm add @vueuse/integrations focus-trap --filter @tracepilot/ui
> ```
> This adds ~15 KB to bundle for a single use case — not justified today.

### Follow-up: Other modals requiring focus traps

The following components also render modal-like overlays and need focus traps added
in a follow-up pass (see audit §6.1):

- `SearchPalette.vue`
- `UpdateInstructionsModal.vue`
- `WhatsNewModal.vue`

### Acceptance Criteria
- Tab key cycles within modal when open
- Focus returns to trigger element on close
- Existing ModalDialog tests pass
- ConfirmDialog (which uses ModalDialog) inherits the fix

---

## E2: Add `type="button"` to All Buttons

13 buttons in `packages/ui/src/components/` need `type="button"`:

| # | File | Line |
|---|------|------|
| 1 | `BtnGroup.vue` | 14 |
| 2 | `ConfirmDialog.vue` | 73 |
| 3 | `ConfirmDialog.vue` | 80 |
| 4 | `FormSwitch.vue` | 14 |
| 5 | `ModalDialog.vue` | 43 |
| 6 | `ReasoningBlock.vue` | 18 |
| 7 | `TabNav.vue` | 20 |
| 8 | `TerminologyLegend.vue` | 14 |
| 9 | `ToastContainer.vue` | 51 |
| 10 | `ToastContainer.vue` | 60 |
| 11 | `ToolCallDetail.vue` | 83 |
| 12 | `ToolCallDetail.vue` | 91 |
| 13 | `ToolDetailPanel.vue` | 54 |

**Change**: For each, add `type="button"` attribute:
```html
<!-- BEFORE -->
<button class="..." @click="...">

<!-- AFTER -->
<button type="button" class="..." @click="...">
```

> Also check `apps/desktop/src/components/` for additional buttons missing the attribute.
> The audit identifies **22+ buttons** total missing `type="button"` — the 13 above cover
> `packages/ui/` only. Approximately 9+ additional buttons in `apps/desktop/src/components/`
> also need checking, including: `ActionButton.vue`, `ErrorAlert.vue`, `ErrorState.vue`,
> `SearchInput.vue`, `ToolCallItem.vue`, `EditDiffRenderer.vue`, `RendererShell.vue`,
> `ToolArgsRenderer.vue`.

### Acceptance Criteria
- `grep -rn '<button' packages/ui/src/components/ | grep -v 'type='` returns 0 results
- All existing UI tests pass

---

## E3: Replace Clickable Divs with Keyboard-Accessible Elements

### Priority targets (5 components):

#### `ToolCallsGroup.vue:28-39`

> **Note**: This element ALREADY has `role="button"` and `:aria-expanded="isExpanded"`.
> Only the following additions are needed:

```html
<!-- BEFORE (already has role="button" and :aria-expanded) -->
<div class="..." role="button" :aria-expanded="isExpanded" @click="toggle">

<!-- AFTER — add tabindex and keyboard handlers only -->
<div class="..." role="button" :aria-expanded="isExpanded" tabindex="0" @click="toggle" @keydown.enter="toggle" @keydown.space.prevent="toggle">
```

#### `OverviewTab.vue:246-255` — checkpoint rows
Same pattern: add `role="button"`, `tabindex="0"`, keyboard handlers.

#### `SessionSearchView.vue:551-558` — search result cards
These are navigation targets. Use `<RouterLink>` or `<a>` instead of `<div @click>`.

#### `WorktreeManagerView.vue:451-494` — tree rows
Add `role="button"`, `tabindex="0"`, Enter/Space handlers.

#### `OrchestrationHomeView.vue:195-204` — quick action cards
Space key handler missing. Add `@keydown.space.prevent="action"`.

#### `GlobTreeRenderer` — tree semantics (audit §6.7)
Add `role="tree"` / `role="treeitem"` semantics and keyboard navigation
(arrow keys for expand/collapse/navigate). Currently has no keyboard support.

> **`aria-expanded` audit**: Toggle divs should also have `aria-expanded` where
> applicable. `ToolCallsGroup` already has it. Verify and add to:
> `OverviewTab` (checkpoint rows), `WorktreeManagerView` (tree rows).

### Acceptance Criteria
- All interactive elements are reachable via Tab key
- Enter/Space activates them
- Screen reader announces them as interactive

---

## E4: Add `aria-label` to Icon-Only Buttons

15+ instances across desktop app. Pattern:

```html
<!-- BEFORE -->
<button @click="refresh">🔄</button>
<button @click="close">✕</button>
<button @click="zoomIn">+</button>

<!-- AFTER -->
<button type="button" @click="refresh" aria-label="Refresh">🔄</button>
<button type="button" @click="close" aria-label="Close">✕</button>
<button type="button" @click="zoomIn" aria-label="Zoom in">+</button>
```

### Key files to update:
- `RefreshToolbar.vue`
- `SearchPalette.vue`
- `TodoDependencyGraph.vue` (zoom controls)
- `SettingsPricing.vue` (add/remove buttons)
- `ConfigInjectorView.vue` (dismiss/remove)
- `WorktreeManagerView.vue` (action buttons)

> **Already labelled** — verify before changing to avoid duplicate labels:
> - `ModalDialog.vue` close button already has `aria-label="Close"`
> - `ToolDetailPanel.vue` close button already has `aria-label="Close detail panel"`
>
> Check each instance before adding a label.

### Acceptance Criteria
- `grep -rn 'aria-label' apps/desktop/src/components/` shows labels on all icon buttons
- Screen reader test: all buttons have announced names

---

## E5: Add Programmatic Labels to Inputs

12+ inputs/selects lack `<label for>` or `aria-label`.

### Pattern A: Use `<label>` (preferred):
```html
<!-- BEFORE -->
<span>Sort by:</span>
<select @change="...">

<!-- AFTER -->
<label for="sort-select">Sort by:</label>
<select id="sort-select" @change="...">
```

### Pattern B: Use `aria-label` (when layout prevents label):
```html
<input aria-label="Search sessions" placeholder="Search..." />
```

### Key files:
- `SearchPalette.vue` — search input
- `TodoDependencyGraph.vue` — zoom slider
- `ExportView.vue` — format select
- `SettingsLogging.vue` — log level select
- `SessionSearchView.vue` — filter inputs
- `ConfigInjectorView.vue` — config inputs
- `SessionLauncherView.vue` — launch inputs
- `WorktreeManagerView.vue` — filter input

### Acceptance Criteria
- No `<input>` or `<select>` without an associated label
- `pnpm --filter @tracepilot/ui test` passes

---

## E-Additional: `aria-expanded` Without `aria-controls` (audit §6.8)

4 components use `aria-expanded` without a corresponding `aria-controls` attribute
pointing to the controlled element's `id`. This is a WCAG best-practice gap:

- `ToolCallsGroup.vue`
- `OverviewTab.vue` (checkpoint rows)
- `WorktreeManagerView.vue` (tree rows)
- `ReasoningBlock.vue`

**Fix**: Add an `id` to each collapsible panel and a matching `aria-controls` to the
toggle element:
```html
<div role="button" aria-expanded="true" aria-controls="panel-123" @click="toggle">
<div id="panel-123" v-show="expanded">...</div>
```

---

## Review Notes

Corrections applied from 4-model review (Sonnet, Opus, Gemini, GPT-4o):

1. **VueUse not available**: `@vueuse/integrations` and `focus-trap` are not in the
   dependency tree. Option B (custom trap) promoted to primary recommendation;
   VueUse moved to "Future Enhancement" note with install command.
2. **Teleport complication**: Added note that `{ flush: 'post' }` is required on the
   visibility watcher because ModalDialog uses `<Teleport to="body">`.
3. **ConfirmDialog conflict**: Added note that ConfirmDialog already focuses cancel
   button on open — trap must not override.
4. **Missing modal focus traps**: Added SearchPalette, UpdateInstructionsModal,
   WhatsNewModal as follow-up items (audit §6.1).
5. **Button count undercount**: Expanded from 13 to 22+ buttons; added list of ~9
   buttons in `apps/desktop/src/components/` needing `type="button"`.
6. **ToolCallsGroup redundancy**: Line 28 already has `role="button"` and
   `:aria-expanded` — plan corrected to add only `tabindex="0"` and keyboard handlers.
7. **`aria-expanded` audit**: Added note to verify OverviewTab and WorktreeManagerView
   toggle divs have `aria-expanded`.
8. **GlobTreeRenderer**: Added as new E3 item — needs tree semantics and keyboard nav
   (audit §6.7).
9. **Existing aria-labels**: ModalDialog and ToolDetailPanel close buttons already
   labelled — added "verify before changing" note to avoid duplicates.
10. **`aria-controls` missing**: Added E-Additional section for 4 components using
    `aria-expanded` without `aria-controls` (audit §6.8).
