# 17 · Settings — scalable panel layout

> **Scope:** The Settings view (`apps/desktop/src/views/SettingsView.vue`) and every panel under `apps/desktop/src/components/settings/`. Defines a left-rail + scrollable-content layout that scales to the **eleven** panels the app already ships, with a single search across all of them and anchor-stable URLs.
> **Inherits:** all of `00-globals.md` (icons, motion, color tokens, `text.micro` discipline) and `01-chrome.md` (one chrome hierarchy — Settings is a destination *inside* `AppSidebar`, not a chrome surface of its own). Composes primitives from `02-primitives.md`.
> **Audit:** closes `UI-AUDIT.md` Settings (lines 155–161) — High priority. The current view is a vertical stack of 11 sections with `text.micro` uppercase labels acting as section headings (`SettingsView.vue:65–71`); discoverability dies past the third fold and the heading style inverts the type-scale intent (CC-10 / G7).
> **Sources:** `apps/desktop/src/views/SettingsView.vue`; panels `SettingsGeneral.vue`, `SettingsAppearance.vue`, `SettingsDataStorage.vue`, `SettingsLogging.vue`, `SettingsPricing.vue`, `SettingsToolVisualization.vue`, `SettingsUpdates.vue`, `SettingsAlerts.vue`, `SettingsExperimental.vue`, `SettingsSdk.vue`, `SettingsAbout.vue`.

A linear stack does not scale to eleven sections. This spec adopts the **Linear / VS Code settings** model: a sticky left rail of section anchors, a scrollable right column with one card per section, and a single search box at the top of the content column that filters rows across **every** panel at once.

---

## 1 · Information architecture

Eleven sections, in this order. Audit copy used the canonical labels in column **A**; the source files render the labels in column **B**. The spec keeps the source labels (so the rail matches what panels render today) and notes the audit alias next to each so cross-referencing works.

| # | Anchor (URL fragment) | Section label (rail) | Source panel | Audit alias |
|---|---|---|---|---|
| 1  | `#general`     | General                | `SettingsGeneral.vue`           | General |
| 2  | `#appearance`  | Appearance             | `SettingsAppearance.vue`        | Appearance · Density · Theme |
| 3  | `#data`        | Data & Storage         | `SettingsDataStorage.vue`       | Indexing |
| 4  | `#logging`     | Logging                | `SettingsLogging.vue`           | Conversation (logs) |
| 5  | `#pricing`     | Pricing                | `SettingsPricing.vue`           | Telemetry (cost-side) |
| 6  | `#tools`       | Tool Visualization     | `SettingsToolVisualization.vue` | Conversation (tool renderers) |
| 7  | `#updates`     | Updates                | `SettingsUpdates.vue`           | Updates |
| 8  | `#alerts`      | Alerts                 | `SettingsAlerts.vue`            | Telemetry (notifications) |
| 9  | `#experimental`| Experimental           | `SettingsExperimental.vue`      | Advanced |
| 10 | `#sdk`         | SDK                    | `SettingsSdk.vue`               | SDK |
| 11 | `#about`       | About                  | `SettingsAbout.vue`             | About |

`Appearance` already covers the audit's "Density" and "Theme" beats — it owns the theme `BtnGroup`, the content-width preset, and the UI scale. There is no separate Density panel and the spec does not introduce one.

The view route stays at `/settings`. Each section is an anchor: `/settings#sdk` scrolls to the SDK card and marks the matching rail item `aria-current="true"`. Anchors are owned by the rail, not the panel — panels do not render their own `id`.

---

## 2 · Layout

A two-column `<SplitPane>` (`02-primitives §SplitPane`) with the rail pinned, the content column scrollable, and a `<ToolbarRow>` welded to the top of the content column. Page width follows `--content-max-width` from `Appearance`, so the user can preview their own width changes live (preserves the existing intent at `SettingsView.vue:50–52`).

```
┌─ PageShell ───────────────────────────────────────────────────────────────────┐
│ <PageHeader title="Settings" />                                               │
├──────────────┬────────────────────────────────────────────────────────────────┤
│ rail (220)   │ <ToolbarRow sticky>                                            │
│              │   [search /]  ⎯⎯⎯⎯⎯⎯⎯⎯⎯  [Reset section]  [Saved · 2s ago]    │
│ General      ├────────────────────────────────────────────────────────────────┤
│ Appearance ◀ │ ┌─ #appearance ─────────────────────────────────────────────┐ │
│ Data & Stor. │ │ <Heading level="2">Appearance</Heading>                   │ │
│ Logging      │ │ <SectionPanel>                                            │ │
│ Pricing      │ │   <Field label="Theme" …>      <BtnGroup …/>              │ │
│ Tool Vis.    │ │   <Field label="Content width" …> <Slider …/>             │ │
│ Updates      │ │   <Field label="UI scale" …>   <Stepper …/>               │ │
│ Alerts       │ │ </SectionPanel>                                           │ │
│ Experimental │ └───────────────────────────────────────────────────────────┘ │
│ SDK          │ ┌─ #data ───────────────────────────────────────────────────┐ │
│ About        │ │ <Heading level="2">Data & Storage</Heading> …             │ │
│              │ └───────────────────────────────────────────────────────────┘ │
│ ─────────────│ … remaining sections render in document order …               │
│ ⌘K shortcut  │                                                               │
└──────────────┴────────────────────────────────────────────────────────────────┘
```

- **Rail** — `<SplitPane left>` with `min: 200`, `max: 280`, `default: 220`, `persistKey: "settings.split"`. Background `--canvas-default`, right edge `1px solid var(--border-subtle)`. Items use the same row recipe as `01-chrome §1.1` (32px row, `radius.md`, `aria-current` rail). Footer of the rail shows a `<kbd>⌘K</kbd>` chip pointing at the in-page search — the rail is **not** chrome, so it does not duplicate the global palette shortcut.
- **Content column** — overflow `auto`, scroll padding `--space-16` so anchored sections do not collide with the sticky toolbar. One `<SectionPanel>` per section. Vertical rhythm between sections is `--space-32`. No per-panel emoji, no per-panel coloured borders.
- **`<ToolbarRow sticky>`** — search input (left, grows), per-section "Reset" button (right, contextual — only for the section currently in view), save status pill (right). Background `--canvas-subtle`, hairline below per `00-globals §G2`.
- **Per-section card composition** — `<Heading level="2">` + optional one-line `<p class="section-lede">` (text.small / `--text-secondary`) + `<SectionPanel>` containing N `<Field>` rows. No second-level uppercase labels inside a panel; sub-grouping uses `<Heading level="3">` and a hairline.

---

## 3 · Tokens used

| Surface | Token |
|---|---|
| Page background | `--canvas-default` |
| Rail background | `--canvas-default` (matches page; only the hairline separates it) |
| Rail item hover | `--surface-tertiary` |
| Rail item active | `--accent-subtle` bg + `inset 2px 0 0 var(--accent-emphasis)` |
| Sticky toolbar | `--canvas-subtle` + `1px solid var(--border-subtle)` bottom |
| Section card | `<SectionPanel>` defaults — `--canvas-raised`, `1px solid var(--border-default)`, `--radius-md` |
| Field row divider | `1px solid var(--border-subtle)` (last child none) |
| Field label | `text.body-strong` / `--text-primary` |
| Field description | `text.small` / `--text-tertiary` |
| Saved pill | `--success-subtle` bg, `--success-fg` text, `--success-muted` border |
| Dirty marker | `--attention-fg` (4px filled dot) |
| Error text | `--danger-fg` |
| Focus ring | `--accent-emphasis`, 2px / 2px offset (per `00-globals §G4`) |
| Motion | `--transition-fast` (120ms) for state, `--transition-normal` (180ms) for the saved pill fade |

No hex anywhere. If a colour is needed and not present, add it to `packages/ui/src/styles/tokens.css` per `00-globals §G6`.

---

## 4 · Component contracts

Settings composes existing primitives (`02-primitives.md`) and introduces three thin form wrappers so panels stop hand-rolling `.setting-row` markup.

### Existing — used as-is
- **`<PageShell>`** — page frame.
- **`<PageHeader title="Settings" />`** — replaces the current ad-hoc `<h1 class="page-title">` at `SettingsView.vue:31`. No breadcrumb (Settings is a leaf destination).
- **`<SplitPane>`** — see `02-primitives §SplitPane`. Used with `persistKey="settings.split"` and the rail on the `left` slot.
- **`<ToolbarRow>`** — sticky toolbar, slots `start` (search), `end` (reset + save status). See `02-primitives §ToolbarRow`.
- **`<Heading level="2">`** — every section title. **This is the entire fix for the audit's `text.micro`-as-heading regression.**
- **`<SectionPanel>`** — already imported by every panel today; spec keeps it as the row container.
- **`<EmptyState>`** — search-no-results state (see §7).
- **`<StatusPill>`** — the "Saved" / "Saving…" / "Error" pill in the toolbar.
- **`<Icon>`** — Lucide only, never emoji (`00-globals §G1`).

### `[NEW PRIMITIVE] <Field>`
Wraps the `label + description + control` row that every panel re-implements today via raw `.setting-row` / `.setting-info` / `.setting-label` divs (`SettingsView.vue:75–106`).

```ts
interface FieldProps {
  label: string;                       // text.body-strong
  description?: string;                // text.small / --text-tertiary
  for?: string;                        // <label for="…"> association; auto-generated if omitted
  layout?: 'inline' | 'stacked';       // default 'inline' (label left, control right)
  status?: 'clean' | 'dirty' | 'error';
  errorMessage?: string;               // rendered into aria-live region when status='error'
  searchTokens?: string[];             // additional tokens this field matches in search
}
// Slot: default = control (a <FormSwitch>, <FormInput>, <BtnGroup>, <Select>, <Stepper>, custom widget…)
// Slot: hint     = optional inline hint right of the control
// Slot: actions  = optional trailing buttons (Reset, Browse…)
```

Lives in `packages/ui/src/components/Field.vue`. Replaces the `:deep(.setting-row*)` rules at `SettingsView.vue:75–217` — those rules are deleted in the migration PR.

### `[NEW PRIMITIVE] <Toggle>`
A thin re-export of the existing `<FormSwitch>` from `@tracepilot/ui`, renamed for vocabulary parity with `<Field>` / `<Select>` and so future Settings work has one obvious name. **Behaviour is unchanged.** Old import path remains exported for one release.

### `[NEW PRIMITIVE] <Select>`
A keyboard-accessible single-select wrapper around the native `<select>`, styled to match `<FormInput>`. Used wherever a panel currently builds a bespoke `<select>` (see `SettingsLogging.vue`, `SettingsExperimental.vue`).

```ts
interface SelectProps<T extends string> {
  modelValue: T;
  options: Array<{ value: T; label: string; description?: string }>;
  size?: 'sm' | 'md';                  // 28 / 32 row height
  placeholder?: string;
}
```

### `[NEW PRIMITIVE] <SettingsRail>`
Internal to `apps/desktop/src/views/settings/`, **not** exported from `@tracepilot/ui`. Renders the eleven anchors using `<nav aria-label="Settings sections">` and an `IntersectionObserver` to keep `aria-current` in sync with the scroll position. This is view-specific glue, not a primitive — keeping it local respects `02-primitives §Common contract` (only generic primitives ship from `@tracepilot/ui`).

---

## 5 · Interaction model

Auto-save is the default; explicit save is reserved for fields that require validation before commit (e.g. `CLI Command`, SDK endpoint). The spec describes both, and the toolbar status pill is the single source of truth.

### Keyboard
| Key | Action | Where |
|---|---|---|
| `j` / `k` | Move selection down / up the section rail | Rail |
| `↑` / `↓` | Same as `j` / `k` (mirror, accessibility) | Rail |
| `Enter` / `Space` | Activate the focused rail item — scrolls the content column to that section, sets `aria-current` | Rail |
| `/` | Focus the in-page search input | Anywhere within the view |
| `Esc` | If search is focused and non-empty: clear. If empty: blur. | Search |
| `⌘S` / `Ctrl+S` | Commit a dirty field (only for fields with explicit save) | Content |
| `g` then `g` | Jump to the first section (parity with other views) | Anywhere |
| `G` | Jump to the last section | Anywhere |

`⌘K` is not handled here — it remains the global command palette (`01-chrome.md`). The settings search is a *scoped* search; `/` is the conventional in-page binding (mirrors `SessionListView`).

### Search semantics
The search input filters every `<Field>` across every panel by matching against:
1. `label` (case-insensitive substring),
2. `description`,
3. `searchTokens` (escape hatch for synonyms — e.g. the Theme field declares `['dark', 'light', 'colour scheme']`),
4. the section label (so typing "sdk" reveals the whole SDK card).

Non-matching fields are hidden (`hidden` attribute, not display:none — preserves layout intent for screen readers). Sections with zero remaining matches collapse to a 1-line stub "No matches in this section". When *all* sections are empty, render `<EmptyState>` (see §7).

### Save model
- **Auto-saved fields** (the majority — toggles, theme, density, sliders) commit on `change` and surface a "Saved" pill for 1.5s (§7).
- **Validated fields** (CLI Command, SDK endpoint, anything string-typed and free-form) hold a "dirty" indicator (4px `--attention-fg` dot to the right of the label) and require `⌘S` or a click on the inline `Save` button. `Esc` reverts the field. The toolbar pill reads "Unsaved changes in <Section>" while any field is dirty.

### Anchors
- Direct navigation to `/settings#sdk` scrolls instantly (`scroll-behavior: auto`, no smooth-scroll on cold load) and focuses the section's `<Heading>` for screen-reader handoff.
- Clicking a rail item updates the URL hash via `history.replaceState` — the back button does not stack settings anchors.

---

## 6 · States

| State | Visual | Trigger |
|---|---|---|
| Clean | Default field rendering, no marker | Initial / after save settles |
| Dirty | 4px `--attention-fg` dot before the label; toolbar pill reads "Unsaved changes" | Validated field edited |
| Saving | Toolbar pill: spinner + "Saving…" (`--neutral-fg`) | Commit in flight |
| Saved | Toolbar pill: `<Icon name="check-circle-2" size="16">` + "Saved" (`--success-fg`), 1.5s then fade | Successful commit |
| Error | Field gains `--danger-fg` border, error string under control via `aria-live="polite"`, toolbar pill: `--danger-fg` + "Couldn't save <field>"  | Backend reject / validation fail |
| Search no-results | Replace the section column with `<EmptyState icon="search-x" title="No settings match \"<query>\"" hint="Try the rail directly, or press Esc to clear." />` | Filter empties every section |
| Loading section | Skeletons sized to final field heights — never collapse the card to a spinner | First mount, async-loaded data (e.g. SDK status) |
| Disabled section | Whole `<SectionPanel>` dimmed via `--text-tertiary` + `aria-disabled="true"`, with a one-line reason at the top | e.g. SDK section while bridge is unreachable |

---

## 7 · Motion

Per `00-globals §G5`. Everything in this view is bounded by 220ms.

- **Section switch (rail click / anchor):** `scroll-behavior: smooth` in the content column, capped at 220ms via custom easing — no slide-in, no fade, no per-section transition. The card is already there; we just bring it into view.
- **Rail `aria-current` update:** colour transition 120ms (`--transition-fast`).
- **Saved pill:** opacity 0 → 1 over 180ms, hold 1500ms, opacity → 0 over 180ms. Width is fixed to prevent toolbar jitter.
- **Dirty dot:** appears instantly. No pulse — `infinite` animations are banned (`00-globals §G5`).
- **Search filter:** rows hide instantly. No height tween.
- **`prefers-reduced-motion`:** scroll-to-section becomes `auto`; pill cross-fade ≤ 80ms.

---

## 8 · Accessibility

- **Rail markup:** `<nav aria-label="Settings sections"><ul role="list">…</ul></nav>`. Active item carries `aria-current="true"` (not `"page"` — Settings *is* the page; the rail navigates within it).
- **Sections:** each `<section aria-labelledby="settings-heading-<anchor>">`, with the `<Heading level="2">` carrying the matching `id`. Scroll-into-view sets focus on the heading (`tabindex="-1"`) so screen readers announce the new region.
- **Form labels:** `<Field>` enforces a `<label for="…">` association — no implicit label nesting around custom controls. Where the control is a `<BtnGroup>` (radio semantics), the field renders `<fieldset>` + `<legend class="sr-only">` instead.
- **Search input:** `role="searchbox"`, `aria-controls` pointing at the content column, `aria-describedby` pointing at a live region that reads "<n> settings match" on debounce.
- **Errors:** rendered in an `aria-live="polite"` region beneath the control. `aria-invalid="true"` on the offending input. The toolbar error pill is `aria-live="assertive"` for the cross-section summary.
- **Reduced motion:** see §7.
- **Density:** the content column inherits the existing `Compact / Comfortable` toggle (`00-globals §G8`); rail rows always render at 32px (Comfortable) regardless — they are chrome-adjacent and must stay finger-/keyboard-friendly.
- **Light mode:** the rail's right hairline must remain visible — verify against `--border-subtle` in light, fall back to `--border-muted` if invisible (per `00-globals §G6` light-mode rule).

---

## 9 · Anti-patterns to remove

Concrete deletions in the migration PR.

1. **`text.micro` uppercase as section heading** — `SettingsView.vue:65–71` (`.settings-section-title`: `font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em`). Closes CC-10 / `00-globals §G7`. Replace every panel's `<div class="settings-section-title">…</div>` with `<Heading level="2">…</Heading>`.
2. **Page-level `<h1 class="page-title page-title-spaced">`** — `SettingsView.vue:31`. Replace with `<PageHeader title="Settings" />` (`01-chrome.md`).
3. **Linear stack of 11 sections** — the entire body of `SettingsView.vue:33–43`. Replace with `<SplitPane>` + `<SettingsRail>` + scrollable content column.
4. **`:deep(.setting-row*)` and friends** — `SettingsView.vue:75–217`. Deleted; `<Field>` owns the row. Each panel migrates from raw divs to `<Field>` props.
5. **Per-panel emoji** — none currently shipping in Settings, but the lint allow-list (`00-globals §G1`) must keep `apps/desktop/src/components/settings/**` *off* the allow-list so future regressions are caught.
6. **Glassmorphism / `backdrop-filter`** — must not appear on the sticky toolbar or the rail. Plain `--canvas-subtle` + hairline (`00-globals §G2`).
7. **Section dividers via `text-transform: uppercase`** elsewhere in panels — replace with `<Heading level="3">` + `1px solid var(--border-subtle)` above (`00-globals §G7`).
8. **Hand-rolled `<select>` styling** — replace with the new `<Select>` wrapper.
9. **Toast spam on every preference change** — explicitly forbidden by MASTER §5. The "Saved" pill is *inline* in the toolbar; nothing is dispatched to the global toast system for routine preference updates. Only `error` states surface as toasts, and only when the toolbar is off-screen.
10. **`--content-max-width` shadowing per panel** — keep the existing inheritance from `.page-content-inner` (the comment at `SettingsView.vue:50–52` is preserved); panels never set `max-width` themselves.

---

## 10 · Acceptance checklist

Settings ships when **all** of the following hold.

### Structure
- [ ] `SettingsView.vue` renders `<PageShell>` → `<PageHeader>` → `<SplitPane>` (rail + content), no other top-level wrappers.
- [ ] All eleven sections from §1 are present, in the listed order, each in its own `<SectionPanel>`.
- [ ] Every section has a stable anchor matching the table in §1; deep-linking to `/settings#<anchor>` scrolls and focuses the heading.
- [ ] No `<h1>..<h6>` literals remain in `apps/desktop/src/components/settings/**` — `<Heading>` only (`02-primitives §Heading` lint).

### Vocabulary
- [ ] `<Field>`, `<Toggle>`, `<Select>` exported from `@tracepilot/ui` and consumed by every panel.
- [ ] No `:deep(.setting-row*)` rules anywhere; the bespoke CSS at `SettingsView.vue:75–217` is gone.
- [ ] No emoji in any settings panel template or data file (`00-globals §G1`).
- [ ] No `linear-gradient`, no `backdrop-filter` in any settings file (`00-globals §G2`, `§G3`).

### Search
- [ ] `/` focuses the search; `Esc` clears then blurs.
- [ ] Search filters fields by `label`, `description`, `searchTokens`, and section label.
- [ ] Empty result renders `<EmptyState icon="search-x">`.
- [ ] Live region announces match count on debounce.

### Save model
- [ ] Auto-saved fields commit on `change`; "Saved" pill fades in/out within the 180ms / 1500ms / 180ms budget.
- [ ] Validated fields show the dirty marker, require `⌘S` (or inline Save), and revert on `Esc`.
- [ ] Errors render under the field and in the toolbar pill via `aria-live`.

### Accessibility
- [ ] Rail is a `<nav aria-label>` with `aria-current="true"` on the active item.
- [ ] Each section is a `<section aria-labelledby>` whose `<Heading>` carries the referenced `id`.
- [ ] All controls have associated labels (`for=` or `<fieldset><legend>` for radio groups).
- [ ] Light / dark parity verified — rail hairline visible in both.
- [ ] `prefers-reduced-motion` removes scroll smoothing and caps cross-fades at 80ms.

### Performance
- [ ] First paint of the view does not block on SDK status — `<SettingsSdk>` renders skeletons until the bridge probe returns.
- [ ] The eleven panels mount lazily as they enter the viewport (Intersection-observer-driven), so the initial DOM cost is bounded by the first 2–3 visible cards.

---

*If a future Settings beat needs to break a rule above, follow the per-view exception protocol in `00-globals.md` ("How per-view specs reference this file") — cite the rule, justify the break, and ship a scoped allow-list.*
