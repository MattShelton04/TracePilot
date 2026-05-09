# 22 · Skills Manager

> **Scope:** `apps/desktop/src/views/skills/SkillsManagerView.vue` and the linked secondary view `apps/desktop/src/views/skills/SkillEditorView.vue` (+ `apps/desktop/src/components/skills/**`, `apps/desktop/src/components/skillEditor/**`). Closes the audit findings in `design-system/audit/UI-AUDIT.md` lines 218–224 (Skills Manager — **High**) and lines 226–232 (Skill Editor — Medium).
> **Inherits:** `00-globals.md` (hygiene rules), `01-chrome.md` (chrome contract), `02-primitives.md` (component vocabulary).
> **Reads from:** `design-system/MASTER.md`.

Skills Manager is the densest concentration of **CC-9** (component duplication) in the Configure section: a hand-rolled modal-overlay, a hand-rolled segmented control, a hand-rolled search input, a bespoke `SkillCard`, an emoji empty state, a glass scrim, and a token-info block that is conceptually identical to the one in MetricsTab. Every one of these is already covered by an existing `@tracepilot/ui` primitive or by a primitive defined in `02-primitives.md`. This spec is about **deleting** the local invention, not adding new patterns.

---

## 1 · Purpose & job-to-be-done

Manage skills (markdown packages that extend the agent). The user must be able to:

1. See **what is installed**, broken down by **scope** (Global / Project) and **enablement** state.
2. Know **how much of the 128k context window** the currently-active skills consume — at all times, not in a hidden tooltip.
3. **Filter** the list by scope and **search** by name/description.
4. **Open** a skill in the editor (the secondary view, §10), **create** a new skill, **import** an existing one, and **delete** with confirm.
5. Read each row's **identity** at a glance: icon, name, scope, source path, last-edited.

The view is *list + filter + budget*, not a dashboard. KPI tiles are not used; the budget is encoded in `<TokenBudgetBar>` and the scope counts are folded into the filter control's badge counts (§4).

---

## 2 · Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ <PageHeader>                                                           │  inherits 01-chrome §1.4
│   ├── BreadcrumbNav: Configure › Skills                                │  01-chrome §1.2
│   ├── Heading level=1: "Skills"                                        │  02-primitives §Heading
│   ├── iconName: zap   (Lucide; never emoji — 00-globals §G1)           │
│   └── #actions:  [↑ Import]  [+ New Skill]  (Lucide upload / plus)     │
├────────────────────────────────────────────────────────────────────────┤
│ <TokenBudgetBar used=enabledTokens cap=128000 unit="tokens"            │  02-primitives §TokenBudgetBar
│                 label="Active skills" caption="N skills enabled"/>     │  (replaces .token-info — CC-7)
├────────────────────────────────────────────────────────────────────────┤
│ <ToolbarRow sticky>                                                    │  02-primitives §ToolbarRow
│   ├── #leading:  <SegmentedControl> All · Global · Project (counts)    │  02-primitives §SegmentedControl
│   └── #trailing: <SearchInput placeholder="Search skills…" ⌘F>         │  02-primitives §SearchInput
├────────────────────────────────────────────────────────────────────────┤
│ <DataGrid> (default) OR <EntityCard> grid (toggle, §6)                 │  02-primitives §DataGrid / §EntityCard
│   row: icon · name · scope · source path (mono) · tokens · updated · ⋯ │
├──────────────────────────── optional ─────────────────────────────────┤
│ <SplitPane> right pane = preview inspector for selected skill         │  02-primitives §SplitPane
│   (frontmatter · token estimate · README excerpt · "Open editor →")    │  hidden until selection
└────────────────────────────────────────────────────────────────────────┘
```

The default body is `<DataGrid>` — it scales past the ~30-skill power-user case. The card grid is a per-view density toggle (`grid` ↔ `rows`) persisted under `localStorage` key `tracepilot:density:skills-manager` per `00-globals §G8`. **One** body geometry; the toggle does not change layout, only row template (see §6).

---

## 3 · Chrome (delete what is local)

### 3.1 · Replace the inline SVG skill icon in `PageHeader`
`SkillsManagerView.vue:71–75` carries an inline SVG "lightning bolt" path inside `<template #icon>`. The spec is `01-chrome §1.4`: the canonical `PageHeader` accepts `iconName: LucideName` and renders through `<Icon>` from `00-globals §G1`. Replace with:

```vue
<PageHeader
  :breadcrumbs="[{ label: 'Configure' }, { label: 'Skills' }]"
  title="Skills"
  iconName="zap"
>
  <template #actions>
    <ActionButton variant="ghost"   iconName="upload" @click="onImport">Import</ActionButton>
    <ActionButton variant="primary" iconName="plus"   @click="onNewSkill">New Skill</ActionButton>
  </template>
</PageHeader>
```

`zap` is the migration-table mapping for ⚡ in `00-globals §G1`. The two header inline SVGs at lines 78–80 (upload arrow) and 84–86 (plus) are **deleted**; `<ActionButton iconName="…">` renders through `<Icon>`.

### 3.2 · Delete the `stats-strip`
Lines 92–113 render four chip-counts (Installed · Global · Project · Active) in a hand-rolled `.stats-strip`. The same information lives in two cleaner places after this redesign:

- **Total active** and the budget percentage are encoded in `<TokenBudgetBar>` (§4).
- **Per-scope counts** fold into the `<SegmentedControl>` option `count` field (`02-primitives §SegmentedControl`), so the chip strip is redundant with the filter row.

The `.stats-strip`, `.stat-chip`, `.stat-dot`, and `.stat-sep` CSS classes are deleted from `SkillsManagerView.vue` style block. No replacement primitive is needed.

---

## 4 · Token budget — promote `.token-info` to `<TokenBudgetBar>` (closes CC-7)

`SkillsManagerView.vue:115–131` renders a bespoke "token-info" block (icon + sentence + horizontal bar) computing `(enabledTokens / 128_000) * 100`. The MetricsTab renders an identical shape against `--total-context`. Both are the same widget; the audit calls this CC-7.

### 4.1 · Bind to `<TokenBudgetBar>`
Per `02-primitives §TokenBudgetBar`, the consumer supplies the `used`, `cap`, label, caption, and tone thresholds — the primitive owns the bar, the percentage typography, the `tnum` numeric column, and the warning/danger tonal transitions. Usage:

```vue
<TokenBudgetBar
  :used="store.tokenBudget.enabledTokens"
  :cap="128_000"
  unit="tokens"
  label="Active skills"
  :caption="`${store.tokenBudget.enabledSkills} skill${store.tokenBudget.enabledSkills === 1 ? '' : 's'} enabled`"
/>
```

Hex constants (`128_000`) belong in a single shared constant (`packages/types/src/constants/contextWindow.ts`) — the cap is the model context window, not a Skills-Manager concern, and MetricsTab will read the same constant.

### 4.2 · Lint surface
- `tracepilot/no-local-reimplementation` (02-primitives Common Contract) gains `.token-info`, `.token-info__bar`, `.token-info__bar-fill`, `.token-info__text` to its forbidden-class list.
- `<TokenBudgetBar>` is the only component allowed to render a `<progress>`-shaped element under the `Skills` route.

---

## 5 · Filter row — replace `.scope-seg-btn` and `.search-input` (closes CC-9)

Lines 134–161 of `SkillsManagerView.vue` reinvent two primitives that already exist in `@tracepilot/ui`. Both are deleted.

### 5.1 · `.scope-seg-btn` → `<SegmentedControl>`
The scope toggle uses three hand-rolled `<button class="scope-seg-btn">` instances. `<SegmentedControl>` (proposed in `11-session-detail-shell.md §11.4` and now landed in `02-primitives §SegmentedControl`) is the canonical replacement. `tracepilot/no-local-reimplementation` already lists `.scope-seg-btn` on its deny list (per `11-session-detail-shell.md §11.4` migration note).

```vue
<SegmentedControl
  v-model="store.filterScope"
  ariaLabel="Filter skills by scope"
  :options="[
    { value: 'all',        label: 'All',     count: store.tokenBudget.totalSkills },
    { value: 'global',     label: 'Global',  count: store.globalSkills.length },
    { value: 'repository', label: 'Project', count: store.repoSkills.length },
  ]"
/>
```

The per-scope counts that previously lived in the `.stats-strip` (§3.2) are now `count` badges on the segmented options — a single read for "what is here, and how much of it".

### 5.2 · `.search-input` → `<SearchInput>`
Lines 150–160 hand-roll an icon + native `<input class="search-input">`. `<SearchInput>` (`packages/ui/src/components/SearchInput.vue`) already exists with the Lucide `search` icon, clear-affordance, debounced `update:modelValue`, and the `⌘F` / `Ctrl+F` keyboard shortcut model.

```vue
<SearchInput
  v-model="store.searchQuery"
  placeholder="Search skills…"
  shortcut="ctrl-f"
  ariaLabel="Search skills"
/>
```

### 5.3 · Wrap in `<ToolbarRow>` (closes CC-9 + replaces glass)
Both controls compose into a single `<ToolbarRow>` (`02-primitives §ToolbarRow`) — the canonical flat hairline toolbar that `00-globals §G2` mandates instead of any `backdrop-filter` chrome. `<ToolbarRow #leading>` carries the segmented control, `<ToolbarRow #trailing>` carries the search input. The bespoke `.filter-row` class is deleted.

---

## 6 · Body — `<DataGrid>` is the default; `<EntityCard>` is the toggle (closes CC-9)

The current body iterates `store.filteredSkills` into a hand-rolled `<SkillCard>` grid. `02-primitives §EntityCard` declares `EntityCard` the **single canonical card archetype** that replaces `SessionCard`, `McpServerCard`, **and `SkillCard`**. `SkillCard.vue` is deleted; the row template moves into a per-view config consumed by both the grid and the table view.

### 6.1 · Row template (shared across grid and table modes)

| Field | Source | Render |
|---|---|---|
| Icon | `skill.iconName` (Lucide) **or** `skill.userEmoji` | `<Icon>` 16px **or** `<UserContentEmoji>` (§7) |
| Name | `skill.name` | `text.body-strong`, `--text-primary`, single line, ellipsis |
| Description | `skill.description` | `text.small`, `--text-secondary`, `text-overflow: ellipsis` (1 line in row, 2 in card) |
| Scope | `skill.scope` (`global` / `repository`) | `<StatusPill tone="neutral|info" iconName="globe|folder">` |
| Source path | `skill.directory` | `text.mono` 12/18, `--text-tertiary`, **middle-truncated** with copy affordance |
| Tokens | `skill.estimatedTokens` | `text.mono` right-aligned, `tnum`, `~12.4k tok` (`formatCompactNumber`) |
| Last edited | `skill.updatedAt` | `text.small`, `--text-tertiary`, relative ("2h ago") |
| Enablement | `skill.enabled` | green dot (`--success-fg`) when on, neutral (`--neutral-fg`) when off |
| Overflow | `⋯` | `<DropdownMenu>`: Open · Reveal in Finder · Copy path · Delete |

### 6.2 · `<DataGrid>` — default mode
Per `02-primitives §DataGrid`. Columns left-aligned except `Tokens` (right). Default sort: `updatedAt desc`. Row height: 32px comfortable / 28px compact (`00-globals §G8`). Selection mode: `single`. Selecting a row reveals the right-pane preview inspector (§8). Clicking the name navigates to the Skill Editor (§10); right-clicking opens the same overflow menu as `⋯`.

### 6.3 · `<EntityCard>` grid — toggle mode
Per `02-primitives §EntityCard`. Map skill fields to `<EntityCard>` props:

```vue
<EntityCard
  :title="skill.name"
  :subtitle="skill.description"
  :iconName="skill.iconName"
  :path="skill.directory"
  :status="{ tone: skill.enabled ? 'success' : 'neutral',
             label: skill.enabled ? 'Enabled' : 'Disabled' }"
  :badges="[
    { label: skill.scope === 'global' ? 'Global' : 'Project', iconName: skill.scope === 'global' ? 'globe' : 'folder' },
    { label: formatCompactNumber(skill.estimatedTokens) + ' tok', mono: true },
  ]"
  :meta="formatRelative(skill.updatedAt)"
  @click="openEditor(skill)"
/>
```

The toggle (`grid | rows`) lives in `<ToolbarRow #trailing>` next to `<SearchInput>` as a 2-option `<SegmentedControl variant=icons>` with `iconName="grid"` / `iconName="list"`. State persists per `00-globals §G8`.

### 6.4 · Empty state — replace `🧠`
Lines 181–191 render `<div class="empty-state__icon">🧠</div>`. Per `00-globals §G1` ("emoji **in template bodies**" — explicitly forbidden) and `02-primitives §EmptyState`, replace with:

```vue
<EmptyState
  v-else
  iconName="book-open"
  title="No skills found"
  :description="store.searchQuery
    ? 'Try a different search term.'
    : 'Create your first skill or import one to get started.'"
  :primaryAction="{ label: 'Create Skill', iconName: 'plus',   onClick: onNewSkill }"
  :secondaryAction="{ label: 'Import',     iconName: 'upload', onClick: onImport }"
/>
```

`book-open` is the migration mapping for the 🧠 placeholder (audit line 223 explicitly prescribes it). The local `.empty-state*` CSS is deleted.

---

## 7 · User-supplied skill icons — `<UserContentEmoji>` quarantine (00-globals §G1)

Skill authors may put an emoji at the top of `SKILL.md` frontmatter (`icon: 🎯`). That emoji is **user content**, not chrome — `00-globals §G1` "User-supplied emoji" carves out a quarantine path for exactly this case.

### 7.1 · Render contract
The skill row icon resolves in this order:

1. If `skill.iconName` is a curated Lucide name → render via `<Icon>` 16px.
2. Else if `skill.userEmoji` is present → render via `<UserContentEmoji>` (the `00-globals §G1` wrapper that uses `font-family: var(--font-sans)`, sizes to the surrounding line-box, sets `aria-hidden="true"`, and adds `outline: 1px solid var(--border-subtle)` + 4px padding).
3. Else → render `<Icon name="zap" size="16" />` (the section default).

### 7.2 · Never the only label
Per `00-globals §G1`, the user emoji is **paired** with `skill.name` in `<EntityCard>` `#title` and `<DataGrid>` `name` column. The row's `aria-label` exposes the name only; the emoji is `aria-hidden`. This survives screen-reader navigation cleanly and matches the rule "Never treat user emoji as the only label".

### 7.3 · Lint surface
The view is **on the §G1 allow-list** for `<UserContentEmoji>` usage — alongside `packages/ui/src/components/UserContentEmoji.vue` itself and the `00-globals §G1` migration table. The lint rule `tracepilot/no-emoji-in-templates` allows the codepoint *only* through `<UserContentEmoji>`; literal emoji in `<template>` bodies (the `🧠` empty-state, the `✕` modal close) still fail.

---

## 8 · New-skill modal — replace `.modal-overlay` with `<ModalDialog>` (closes CC-9 + G2)

Lines 194–230 of `SkillsManagerView.vue` hand-roll a modal: `<div class="modal-overlay">` scrim, `.modal` panel, `<button class="modal__close">✕</button>` literal, and a `backdrop-filter: blur(4px)` on the scrim at line 561.

### 8.1 · `<ModalDialog>` already exists
`packages/ui/src/components/ModalDialog.vue` is the canonical primitive. It owns the scrim (the **only** legal `backdrop-filter` per `00-globals §G2`), the panel surface (`--canvas-raised` + 1px hairline + `--shadow-lg` per `00-globals §G2` recipe), focus-trap, `Esc` dismissal, and the close button (`<Icon name="x">` — never the literal `✕`).

```vue
<ModalDialog
  v-model:open="showNewSkillModal"
  title="New Skill"
  size="sm"
  :primaryAction="{ label: creating ? 'Creating…' : 'Create',
                    variant: 'primary',
                    disabled: !newSkillName.trim() || creating,
                    onClick: handleCreateSkill }"
  :secondaryAction="{ label: 'Cancel', variant: 'ghost', onClick: () => (showNewSkillModal = false) }"
>
  <FormRow label="Name" :error="nameError">
    <FormInput v-model="newSkillName" placeholder="my-skill-name" @keydown.enter="handleCreateSkill" />
  </FormRow>
  <FormRow label="Description" :hint="'Optional — you can edit this on the next page.'">
    <FormTextarea v-model="newSkillDesc" rows="3" placeholder="What does this skill do?" />
  </FormRow>
</ModalDialog>
```

### 8.2 · Delete the local CSS
Removed from the view's `<style scoped>` block:
- `.modal-overlay` (lines 553–561) — including the **glass scrim** (`backdrop-filter: blur(4px)`) which `00-globals §G2` reserves for `packages/ui/src/components/Modal/scrim.css` only.
- `.modal`, `.modal__header`, `.modal__title`, `.modal__close`, `.modal__body`, `.modal__label`, `.modal__optional`, `.modal__input`, `.modal__textarea`, `.modal__hint`, `.modal__validation-hint`, `.modal__footer`.

### 8.3 · Lint surface
- `tracepilot/no-local-reimplementation` (02-primitives Common Contract) already lists `.modal-overlay` on its deny list — this view is the named example. After this lands the rule is enforced.
- `tracepilot/no-backdrop-filter` (00-globals §G2) flags the line-561 blur; the only allow-listed file is the canonical scrim.
- `tracepilot/no-emoji-in-templates` flags the literal `✕` at line 198; `<ModalDialog>` close uses `<Icon name="x">`.

The Import wizard (`SkillImportWizard.vue`) gets the same migration in the same PR — it currently re-uses the local `.modal-overlay` pattern. The audit's CC-9 closure for this view requires both modals to ship through `<ModalDialog>`.

---

## 9 · Optional preview inspector — `<SplitPane>`

When `selectionMode="single"` and a row is selected, the body becomes a `<SplitPane id="skills-manager">` with the `<DataGrid>` on the left and a preview inspector on the right. Per `02-primitives §SplitPane`: 320px initial right pane, 240–480 min/max, persisted under `tracepilot:splitpane:skills-manager`, keyboard-resizable per `00-globals §G8`. Closing the inspector returns to a single-pane grid.

The right pane renders, top-to-bottom:
1. `<Heading level="2">{{ skill.name }}</Heading>` + `<StatusPill>` (enabled/disabled).
2. `<DefList>`: scope · directory (mono) · last edited · token estimate · asset count.
3. `<MarkdownContent>` — first 40 lines of `SKILL.md` for context.
4. Sticky footer: `[Open in editor →]` (primary) · `[Reveal] [Delete]` (ghost).

**No card-inside-card.** The inspector is a single `<SectionPanel>` per `02-primitives §EntityCard` "When NOT to use EntityCard" (preview pane is a detail view, not a card). The inspector is closed by default — opening it is an explicit selection action, not an automatic state.

---

## 10 · Skill Editor (linked secondary view)

`SkillEditorView.vue` is the destination of "Open in editor" and any row click. The audit (lines 226–232) lists three weaknesses; this spec resolves them by alignment, not by re-statement.

### 10.1 · Adopt `<DetailShell>` chrome
Replace the bespoke top bar (skill name, scope, save state) with the same shell pattern proposed in `11-session-detail-shell.md` and used by McpServerDetail (`16` audit line 215, "shared `<DetailShell>` primitive"):

```
<DetailShell>
  <PageHeader breadcrumbs=[{ label: 'Configure' }, { label: 'Skills', to: 'skills-manager' }, { label: skill.name }]
              title=skill.name iconName=zap dirty=hasUnsavedChanges>
    <template #actions>
      <ActionButton iconName="save"   variant="primary" :shortcut="'cmd-s'">Save</ActionButton>
      <ActionButton iconName="rotate-ccw" variant="ghost">Revert</ActionButton>
      <ActionButton iconName="external-link" variant="ghost">Reveal</ActionButton>
    </template>
  </PageHeader>
  …body…
</DetailShell>
```

The "dirty" indicator (`•` next to the title when `hasUnsavedChanges === true`) is part of the canonical `<PageHeader>` contract (`01-chrome §1.4` `dirty` prop).

### 10.2 · Use `<SplitPane>` instead of the `onMouseDown` handler
The current splitter is a hand-written `onMouseDown` listener (audit line 230 — same CC-8 case as ExplorerTab). Replace with `<SplitPane id="skill-editor">` per `02-primitives §SplitPane`. Persistence key: `tracepilot:splitpane:skill-editor`. Keyboard resize and `prefers-reduced-motion` come for free.

### 10.3 · Delete the linear-gradient and 20px heading
`apps/desktop/src/styles/features/skill-editor.css` carries a `linear-gradient(...)` fill (audit line 230, `00-globals §G3`) and a `font-size: 20px` heading rule (`00-globals §G3` "hero typography cap"). Both are deleted; headings come from `<Heading level="2|3">` (`02-primitives §Heading`).

### 10.4 · No new patterns
The editor view does **not** introduce a Monaco swap, a diff-vs-saved view, or any other audit "opportunity" item in this PR. Those are correctness/feature tasks tracked separately. This spec only enforces shell + splitter + token hygiene — the minimum needed to close the audit's Medium-priority finding.

---

## 11 · Acceptance

Each item below must be machine-verifiable. Skills Manager is not "done" until every box is checked.

### Emoji & icons (00-globals §G1)
- [ ] `rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src/views/skills apps/desktop/src/components/skills apps/desktop/src/components/skillEditor` returns **zero** hits in `<template>` bodies (literal `🧠` at line 182 and `✕` at line 198 are gone).
- [ ] `<PageHeader>` is rendered with `iconName="zap"`; the inline `<svg>` at lines 71–75 is removed.
- [ ] `<ActionButton iconName="upload|plus">` replaces the inline header SVGs at lines 78–80 and 84–86.
- [ ] User-supplied skill icons render through `<UserContentEmoji>` only; the wrapper appears on the §G1 allow-list.

### Component duplication (CC-9 — primitives)
- [ ] `apps/desktop/src/components/skills/SkillCard.vue` is **deleted**; rows render through `<EntityCard>` (grid mode) or `<DataGrid>` (table mode).
- [ ] `rg "modal-overlay" apps/desktop/src/views/skills apps/desktop/src/components/skills` returns zero hits — both the New Skill modal and `SkillImportWizard` use `<ModalDialog>`.
- [ ] `rg "scope-seg-btn" apps/desktop/src` returns zero hits — replaced by `<SegmentedControl>` from `@tracepilot/ui`.
- [ ] `rg "class=\"search-input\"" apps/desktop/src/views/skills` returns zero hits — replaced by `<SearchInput>`.
- [ ] Stylelint `tracepilot/no-local-reimplementation` passes on this view (deny-list extended with `.modal-overlay`, `.scope-seg-btn`, `.search-input`, `.token-info`, `.skill-card`).

### Token budget (CC-7)
- [ ] `<TokenBudgetBar>` replaces lines 115–131; `.token-info*` CSS is deleted from the view's style block.
- [ ] The 128k cap is read from `packages/types/src/constants/contextWindow.ts`, not inlined.
- [ ] MetricsTab and Skills Manager render the same `<TokenBudgetBar>` component (verified by snapshot test).

### Glass & gradients (00-globals §G2 / §G3)
- [ ] `rg "backdrop-filter" apps/desktop/src/views/skills apps/desktop/src/components/skills apps/desktop/src/components/skillEditor` returns zero hits (the line-561 `blur(4px)` is gone).
- [ ] The only `backdrop-filter` reachable from this route lives in `packages/ui/src/components/Modal/scrim.css`.
- [ ] `rg "linear-gradient" apps/desktop/src/styles/features/skill-editor.css apps/desktop/src/views/skills` returns zero hits.

### Tokens & hex (00-globals §G6)
- [ ] Stylelint `color-no-hex` passes on `apps/desktop/src/views/skills/**` and the linked `apps/desktop/src/styles/features/skill-editor.css`.
- [ ] No `rgb(...)` / `rgba(...)` literals (the `rgba(0, 0, 0, 0.6)` at line 557 leaves with the modal migration).

### Layout
- [ ] `<PageShell>` contains exactly **one** `<PageHeader>`, **one** `<TokenBudgetBar>`, **one** `<ToolbarRow>`, and **one** body region (`<DataGrid>` or `<EntityCard>` grid).
- [ ] The grid/list density toggle persists under `localStorage` key `tracepilot:density:skills-manager`.
- [ ] When a row is selected, the body becomes a `<SplitPane id="skills-manager">`; deselecting collapses back to a single pane.

### Behaviour
- [ ] `Cmd/Ctrl+F` focuses the `<SearchInput>` (delegated to the primitive's `shortcut` prop).
- [ ] `←/→` moves focus across `<SegmentedControl>` options without activating; `Enter`/`Space` activates (`02-primitives §SegmentedControl`).
- [ ] Per-scope counts in the segmented control match `store.globalSkills.length` / `store.repoSkills.length` exactly.
- [ ] Deleting a skill goes through `<ConfirmDialog variant="danger">` (`@tracepilot/ui`) — the existing `useConfirmDialog()` call survives, the local modal does not.
- [ ] Empty state renders `<EmptyState iconName="book-open">`; both primary (Create) and secondary (Import) actions are wired.

### Skill Editor (secondary view)
- [ ] `SkillEditorView.vue` composes `<DetailShell>` + `<PageHeader iconName="zap" :dirty="hasUnsavedChanges">`.
- [ ] The splitter is `<SplitPane id="skill-editor">` — no `onMouseDown` handler in this view.
- [ ] `apps/desktop/src/styles/features/skill-editor.css` contains zero `linear-gradient` and zero `font-size:` rules above 16px.

---

## 12 · Migration order

1. Land the **`<TokenBudgetBar>`** consumer migration (§4) — both Skills Manager and MetricsTab swap to the primitive in the same PR. Add `packages/types/src/constants/contextWindow.ts`.
2. Migrate the **filter row** (§5): `<SegmentedControl>`, `<SearchInput>`, wrapped in `<ToolbarRow>`. Delete `.scope-seg-btn`, `.search-input`, `.filter-row`.
3. Replace **`SkillCard`** with `<EntityCard>` (§6.3) and `<DataGrid>` (§6.2). Delete `apps/desktop/src/components/skills/SkillCard.vue`. Add the user-emoji branch via `<UserContentEmoji>` (§7).
4. Swap the **New Skill modal** and **`SkillImportWizard`** to `<ModalDialog>` (§8). Delete `.modal-overlay` and the line-561 glass scrim.
5. Replace the **empty state** (§6.4) and delete `.empty-state*` CSS.
6. Apply the **`<DetailShell>` + `<SplitPane>`** migration to `SkillEditorView.vue` (§10). Delete the `linear-gradient` and 20px heading rules in `skill-editor.css`.
7. Run lint: `tracepilot/no-emoji-in-templates`, `tracepilot/no-local-reimplementation`, `tracepilot/no-backdrop-filter`, `color-no-hex`, `tracepilot/single-page-header`. All must pass before merge.

> When this view ships, the audit's note that Skills Manager has "multiple bespoke widgets duplicating shared library" is closed. Subsequent regressions must fail lint, not review.
