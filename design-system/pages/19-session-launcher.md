# 19 · Session Launcher

> **Inherits:** all of `00-globals.md` (icons, glass ban, motion, color tokens, no-emoji rule) and `01-chrome.md` (Session Launcher is a destination *inside* `AppSidebar`, not a chrome surface of its own). Composes primitives from `02-primitives.md`.
> **Audit:** closes `UI-AUDIT.md` Session Launcher (lines 186–192) — High priority. The current view bakes emoji into the template data model, hand-rolls a split layout, and renders a glass overlay on the delete confirm.
> **Sources:** `apps/desktop/src/views/orchestration/SessionLauncherView.vue`; panels `SessionLauncherTemplates.vue`, `SessionLauncherConfig.vue`, `SessionLauncherPrompt.vue`, `SessionLauncherAdvanced.vue`, `SessionLauncherSaveTemplate.vue`, `SessionLauncherPreview.vue`; styles `apps/desktop/src/styles/features/session-launcher.css`.

The Session Launcher is the **gated entry point** to actually using TracePilot — it is the surface where a user picks a template, names an agent, and presses Launch. Everything here must read like a precision dev tool: a two-pane workbench with one form and one live preview, no decorative chrome, no emoji.

---

## 1 · Information architecture

A two-pane workbench. The left pane is the **config column**, the right pane is the **preview column**. Both are scrollable; the left holds form sections, the right holds the resolved CLI command + the templates picker.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ <PageHeader title="Launch Session" subtitle="…" />                            │
├──────────────────────────┬───────────────────────────────────────────────────┤
│  Config column           │  Preview column                                    │
│  (scrollable)            │  (scrollable, sticky resolved-command at top)      │
│                          │                                                    │
│  ┌─ Templates ────────┐  │  ┌─ Resolved command ──────────────────────────┐  │
│  │ <Field> picker     │  │  │ $ copilot --agent main --model gpt-5.5 …   │  │
│  └────────────────────┘  │  │                                  [⎘ Copy]  │  │
│  ┌─ Agent & model ────┐  │  └──────────────────────────────────────────────┘ │
│  │ <Field> agent rail │  │                                                    │
│  │ <Field> <Select>   │  │  ┌─ Templates ──────────────────────────────────┐ │
│  └────────────────────┘  │  │  <DataGrid> rows: icon · name · category …  │ │
│  ┌─ Prompt ───────────┐  │  └──────────────────────────────────────────────┘ │
│  │ Monaco-style mono  │  │                                                    │
│  └────────────────────┘  │  ┌─ Diff vs. last launch ───────────────────────┐ │
│  ┌─ Files & skills ───┐  │  │  changed: model · prompt (+12 / −4 lines)    │ │
│  └────────────────────┘  │  └──────────────────────────────────────────────┘ │
│  ┌─ Advanced ▸ ───────┐  │                                                    │
│  │ working dir, env…  │  │                                                    │
│  └────────────────────┘  │                                                    │
│  ┌─ Save as template ─┐  │                                                    │
│  └────────────────────┘  │                                                    │
└──────────────────────────┴───────────────────────────────────────────────────┘
```

The split itself is the canonical `<SplitPane>` (`02-primitives §SplitPane`), with `paneId="session-launcher.split"`, `initialSize="56%"`, `min={420}`, `collapsible="second"`. The hand-rolled `.split-layout` / `.panel-left` / `<SessionLauncherPreview>` flex shell at `SessionLauncherView.vue:35–70` is replaced; this is one of the four splitters CC-8 calls out.

---

## 2 · Form column — section breakdown

Every form section is a `<SectionPanel>` containing N `<Field>` rows, with a `<Heading level="2">` as the section title. **No `text.micro` uppercase headings** (`00-globals §G7`). Sub-grouping inside a panel uses `<Heading level="3">` and a hairline.

### 2.1 Agent selection

The agent picker uses the **categorical agent-color tokens** from `MASTER §2.4` as a left-edge color rail on each agent option, paired with a Lucide glyph and a label. Color is never the only signal — the agent name and the glyph carry equal weight (`00-globals §G6` and the MASTER anti-pattern "color-only state").

```
<Field label="Agent" description="Which sub-agent role to launch under">
  <BtnGroup>
    [▌🤖 Main]   [▌🔍 Explore]   [▌🧠 General-purpose]
    [▌🪶 Code-review]  [▌🦆 Rubber-duck]  [▌⚡ Task]
  </BtnGroup>
</Field>
```

| Agent option | Color token | Lucide name |
|---|---|---|
| Main | `--agent-color-main` | `bot` |
| Explore | `--agent-color-explore` | `compass` |
| General-purpose | `--agent-color-general-purpose` | `brain` |
| Code-review | `--agent-color-code-review` | `scan-eye` |
| Rubber-duck | `--agent-color-rubber-duck` | `message-circle-question` |
| Task | `--agent-color-task` | `list-checks` |

The selected agent's color rail is a 2px inset on the active button (`box-shadow: inset 2px 0 0 0 var(--agent-color-…)`), the rest of the surface stays neutral. The same rail repeats in the resolved-command preview header so the user can see at a glance which agent is being launched.

### 2.2 Prompt textarea

The prompt control is a **Monaco-style mono editor** (the same component used in `12-conversation-tab.md` for inline edits — re-export, do not fork). Body uses `var(--font-mono)`, `text.code` (13/20), with `font-feature-settings: 'tnum' 1`. Line numbers off by default; soft-wrap on; tab inserts spaces (per Copilot CLI convention). The whole editor sits in a `<Field label="Prompt" description="What you want the agent to do">` so it inherits row metrics.

`Cmd/Ctrl+Enter` from inside the editor **launches the session**, matching the audit's "Missing: no Cmd+Enter shortcut to launch from prompt." The shortcut is registered globally for the view, not just the editor.

### 2.3 Files & skills attachment

A single `<Field label="Attachments">` containing two stacked sub-rows:

- **Files** — chip list of attached paths (`text.mono`, mid-truncated), `+ Add file` opens a native file picker. Drag-and-drop onto the editor surface also lands here. Each chip has a Lucide `x` to remove.
- **Skills** — multi-select against the user's skill library (Lucide `wrench` glyph). Selected skills render as pills with the skill's icon. The pill icon, not the skill author's emoji, is the source of truth here — see §6.2 for how user-supplied emoji are quarantined when the skill author chose one.

Both sub-rows render as `<Field>` children under the parent label, separated by a 1px hairline (`--border-subtle`).

### 2.4 Advanced (collapsed by default)

A `<Disclosure>` titled "Advanced", collapsed by default, containing `<Field>` rows for:

| Field | Control | Notes |
|---|---|---|
| Model | `<Select>` (see §4) | Options come from the active model registry. |
| Working directory | `<FormInput>` + Browse button | Path is mono; Browse opens the OS dialog. |
| Worktree | `<Select>` | Lists discoverable worktrees for the current repo (mono path). |
| Environment vars | `<KeyValueEditor>` | Existing primitive in `apps/desktop`. |
| Resume from session | `<Select>` searchable | Optional; shows session ID + summary. |
| Custom CLI flags | `<FormInput>` | Mono; flags are appended verbatim to the resolved command. |

The audit's "no diff vs. last-launched" gap is closed in the **preview column**, not here (§3.2).

### 2.5 Save as template

A `<Disclosure>` toggled by a `<Toggle label="Save as template">`. When open, it renders three `<Field>` rows: **Name** (required), **Category**, **Description**, plus an **Icon** field — the icon picker is now `<LucideIconPicker>` (§4.1), not a free-form text input. The current `placeholder="🚀"` literal at `SessionLauncherSaveTemplate.vue:32` is removed; the Icon field stores a Lucide *name string* (e.g. `"rocket"`), not an emoji codepoint.

---

## 3 · Preview column

The right pane is read-only and serves three purposes: confirm the resolved command, browse/pick templates, and diff against the last launch.

### 3.1 Resolved command

Sticky to the top of the preview pane. A single mono block on `--canvas-inset`, with a `<Icon name="copy" size="16">` button that writes the exact string to the clipboard. The agent-color rail (§2.1) repeats as a 2px inset on the left edge of this block so the agent identity is reinforced. No syntax highlighting beyond color-by-flag-class is needed — the goal is *fidelity*, not decoration.

### 3.2 Templates picker (was `<SessionLauncherTemplates>`)

A `<DataGrid>` (`02-primitives §DataGrid`), **not** a card grid. Columns:

| Column | Render | Notes |
|---|---|---|
| Icon | `<Icon name={tpl.icon} size="16">` | Lucide glyph from the migrated `icon` field — see §6.1. |
| Name | `text.body-strong` | Truncate. |
| Category | `<StatusPill tone="neutral">` | Optional; absent for uncategorised. |
| Used | numeric, mono, tnum, right-aligned | Replaces "Used N times" string. |
| Last used | relative time, mono | New column, replaces audit gap. |

Rows expose `#row-actions` with **Apply**, **Edit**, **Delete** as `<IconButton>`s. Right-click context menu is preserved for parity with today; the inline `tpl-card-actions` ▲ ▼ × stack at `SessionLauncherTemplates.vue:51–69` is **deleted** — `<DataGrid>` reordering uses keyboard `Alt+↑/↓` on a focused row, and the `j/k` bindings inherited from the primitive.

The "Restore Defaults" affordance moves into the `<DataGrid>` toolbar `#toolbar` slot as a `<Button variant="ghost" iconName="rotate-ccw">Restore defaults</Button>` — replacing the `↻ Restore Defaults` text-button at `SessionLauncherTemplates.vue:32`.

### 3.3 Diff vs. last launch

A `<RendererShell>` (`02-primitives §RendererShell`) with `toolName="diff"`, `iconName="git-compare"`, `status="success"`, no footer. Body is a compact two-column diff of the *resolved command parts* (agent, model, working dir, prompt) between the current form state and the last successfully launched session. Empty state for "no previous launch" uses `<EmptyState size="sm" iconName="rocket">` with a one-line hint.

---

## 4 · Primitives

Session Launcher composes existing primitives (`02-primitives.md`) and introduces one new picker (`<LucideIconPicker>`). The form wrappers `<Field>`, `<Toggle>`, `<Select>` are **the same primitives proposed by `17-settings.md`** — Session Launcher and Settings consume one library, not two. If 17-settings lands first, this view imports them as-is; if 19 lands first, the components live in `packages/ui/src/components/Field.vue` etc. exactly as 17-settings specifies, with `17-settings.md §6` as the single source of truth for their props.

### Existing — used as-is

- **`<SplitPane>`** with `paneId="session-launcher.split"`. The hand-rolled `.split-layout` at `SessionLauncherView.vue:35` is removed.
- **`<DataGrid>`** for templates. Replaces `.tpl-grid` + `.tpl-card`.
- **`<RendererShell>`** for the diff block.
- **`<EmptyState>`** for "no previous launch" and the "no templates yet" zero state currently gated by `v-if="store.loading || store.templates.length || hasDismissedDefaults"`.
- **`<ToolbarRow>`** above the `<DataGrid>` template list.
- **`<StatusPill>`** for category and the "System not ready" readiness banner currently rendered as a hand-rolled `.readiness-banner` at `SessionLauncherView.vue:44–58` — replaced by `<Banner tone="warning">` (existing primitive) with a Lucide `triangle-alert`, not the inline SVG.
- **`<Heading>`** for every section title, replacing `.section-label` (`SessionLauncherTemplates.vue:25`).
- **`<UserContentEmoji>`** (`00-globals §G1`) — the quarantine wrapper for legacy user templates that still carry an emoji string in `tpl.icon` (§6.1).

### Proposed — shared with `17-settings.md`

- **`<Field>`** — wraps `label + description + control` rows. See `17-settings.md §6 [NEW PRIMITIVE] <Field>`.
- **`<Toggle>`** — re-export of `<FormSwitch>`. Used by §2.5 Save-as-template.
- **`<Select>`** — keyboard-accessible single-select. Used by §2.4 Model / Worktree / Resume.

### `[NEW PRIMITIVE] <LucideIconPicker>`

Not present in `02-primitives.md` today; this view introduces it because template icons need a curated set, not the full Lucide catalogue.

```ts
interface LucideIconPickerProps {
  modelValue: LucideName | null;
  catalogue?: LucideName[];          // default = the curated 50-glyph dev-tool subset
  placeholder?: string;              // shown when modelValue is null
  size?: 'sm' | 'md';                // sm=24px tile, md=32px tile (default sm here)
}
// Emits: 'update:modelValue'
```

**Behaviour.** A `<Popover>` triggered by a 24px tile that renders the currently selected glyph (or a Lucide `circle-dashed` placeholder when null). The popover body is a 6-column grid of `<Icon>` tiles, each tile 24×24 with 4px padding, hover bg `--surface-tertiary`, selected ring `var(--accent-emphasis)`. A `<FormInput>` at the top of the popover filters the catalogue by name (substring match). Keyboard: `↑/↓/←/→` move focus across tiles, `Enter` selects, `Esc` closes.

**Catalogue.** The default 50-glyph curated dev-tool subset lives in `packages/ui/src/icons/templateCatalogue.ts` and includes (non-exhaustive): `rocket`, `bot`, `compass`, `brain`, `scan-eye`, `wrench`, `bug`, `git-branch`, `git-pull-request`, `terminal`, `code`, `file-text`, `folder`, `database`, `cloud`, `zap`, `target`, `flag`, `bookmark`, `book-open`, `flask-conical`, `hammer`, `package`, `play`, `refresh-cw`, `search`, `settings`, `shield`, `sparkles`, `square-stack`, `test-tube`, `triangle-alert`, `workflow`. The set is fixed in the spec so template icons are stable across users — adding to it is a deliberate change, reviewed alongside token additions.

**Library.** `packages/ui/src/components/LucideIconPicker.vue`, exported from `@tracepilot/ui`.

**Fallback.** When `modelValue` is a string that is not in the catalogue and is not a valid Lucide name (i.e. legacy emoji), the trigger tile renders `<UserContentEmoji>` with the string and the popover opens with no tile selected — the user is invited to pick a Lucide glyph to migrate (§6.1).

---

## 5 · Interaction model

### Keyboard

| Key | Action | Scope |
|---|---|---|
| `Cmd/Ctrl+Enter` | Launch the session with the current form state | Anywhere in the view |
| `Cmd/Ctrl+S` | Save as template (opens §2.5 if collapsed, focuses Name field) | Anywhere |
| `Cmd/Ctrl+K` | Focus the templates `<DataGrid>` filter chip / search | Anywhere |
| `Esc` | Cancel inline delete confirm; close icon picker; close advanced | Per surface |
| `Tab` / `Shift+Tab` | Walk fields in visual order (form first, then preview) | Anywhere |
| `Alt+←/→` (handle focused) | Resize the split | Inherited from `<SplitPane>` |
| `j` / `k`, `↑` / `↓` | Move row selection in the templates grid | `<DataGrid>` |
| `Enter` | Apply the focused template | Templates grid |
| `Delete` | Delete the focused template (with inline confirm) | Templates grid |

### Launch button

A primary `<Button variant="primary" iconName="play">Launch</Button>` welded to the **bottom of the form column** in a `<ToolbarRow variant="header" sticky>` so it survives long prompts. The button shows an inline spinner during the launch RPC and **disables** while `store.isReady === false` — the readiness banner above explains why. No toast on success: routine success is inline (per MASTER §5).

### Density

This view is **always Comfortable**. The compact density toggle is intentionally absent because the form rows are not a dense data surface; consistency with `00-globals §G8` is preserved by simply not exposing the toggle here.

---

## 6 · Templates data migration

### 6.1 `icon` field: emoji string → Lucide name

**Today.** `Template.icon` is a free-form string that callers fill with an emoji codepoint. `templateIcon(tpl)` at `SessionLauncherTemplates.vue:79` renders it inside `<span class="tpl-emoji">`, and `SessionLauncherSaveTemplate.vue:32` exposes a literal text input with `placeholder="🚀"` to encourage the user to type an emoji. This is the strongest signal in the app that emoji-as-icon is **baked into the data model**, not just decoration (audit 186–192, `00-globals §G1`).

**Tomorrow.** `Template.icon` becomes `LucideName | null`:

```ts
// packages/types/src/templates.ts
export interface Template {
  id: string;
  name: string;
  // icon: string;            // ← removed
  icon: LucideName | null;    // ← Lucide name, e.g. 'rocket'
  legacyEmoji?: string;       // ← preserves the user's previous emoji for one release
  // …
}
```

**Migration step (one-shot, on store load).**
1. For each user template, if `icon` matches a key in the migration table at `00-globals §G1`, set `icon` to the mapped Lucide name and clear `legacyEmoji`.
2. Else if `icon` matches an entry in the `LucideIconPicker` catalogue (§4.1) by name, keep it.
3. Else, move the original string into `legacyEmoji` and set `icon = null`. The template still renders — see §6.2.

The migration runs in the templates store on first load post-upgrade and is idempotent. Default templates ship with valid Lucide names from day one.

### 6.2 Quarantining legacy emoji

A template whose migration left `icon === null && legacyEmoji != null` renders its row in the `<DataGrid>` with the icon column wrapped in `<UserContentEmoji>` (`00-globals §G1`). The wrapper:

- Constrains size to the surrounding `text.body` line-box (no oversize).
- Uses `font-family: var(--font-sans)` to avoid forced system-emoji.
- Adds `outline: 1px solid var(--border-subtle)` + 4px padding so it reads as quarantined, not chrome.
- Sets `aria-hidden="true"`; the row's `aria-label` carries the template name, never the emoji.

Hovering the quarantined cell shows a tooltip "Pick a Lucide icon to upgrade this template" linking to the edit form, where `<LucideIconPicker>` opens with no selection. This is the only surface in the app where user-supplied emoji are tolerated — and only as a temporary, opt-out-by-editing state.

---

## 7 · Anti-patterns this spec eliminates

Each item below is a concrete violation in the current code; the migration PR for this view must remove all of them.

1. **Emoji as icon — baked into data.** `SessionLauncherTemplates.vue:37` (`<span class="tpl-emoji">⏳</span>` skeleton placeholder) and `SessionLauncherTemplates.vue:79` (`<span class="tpl-emoji">{{ templateIcon(tpl) }}</span>`) — both render emoji as the primary visual identifier of a template. Replaced by `<Icon>` driven by the migrated `icon: LucideName` field (§6.1). The skeleton placeholder becomes a `<Icon name="circle-dashed" />` at `--text-tertiary`.
2. **Emoji as input encouragement.** `SessionLauncherSaveTemplate.vue:32` — `<input … placeholder="🚀" maxlength="14" />` plus the hint "Emoji shown on the template card". Replaced by `<LucideIconPicker>` (§4.1). The text input is removed; the form hint becomes "Pick an icon for this template".
3. **Emoji as save-toggle label.** `SessionLauncherSaveTemplate.vue:11` — `<span>💾 Save as Template</span>`. Replaced by `<Toggle label="Save as template">` (§2.5).
4. **Emoji as restore button.** `SessionLauncherTemplates.vue:32` — `↻ Restore Defaults`. Replaced by `<Button iconName="rotate-ccw">Restore defaults</Button>` in the `<DataGrid>` toolbar.
5. **Glassmorphism on the inline delete confirm.** `apps/desktop/src/styles/features/session-launcher.css:793` — `backdrop-filter: blur(2px)` on the `.tpl-delete-overlay` panel (CC-2 / `00-globals §G2`). Replaced by an opaque overlay: `background: var(--canvas-overlay); border: 1px solid var(--border-default); box-shadow: var(--shadow-md);` per the recipe table in `00-globals §G2`. The audit allows blur **only** on the modal scrim file; this overlay is not a modal scrim.
6. **Hand-rolled split layout.** `SessionLauncherView.vue:35–70` (`.split-layout`/`.panel-left` flex shell) — replaced by `<SplitPane paneId="session-launcher.split">` (CC-8).
7. **Inline SVG icons.** `SessionLauncherView.vue:29` (delete-template context menu) and `:45` (readiness banner) — both inline SVG paths. Replaced by `<Icon name="trash-2" />` and `<Icon name="triangle-alert" />` (`00-globals §G1` forbids inline SVG icon paths in `apps/desktop/src/**/*.vue`).
8. **`<h2 class="section-label">`** at `SessionLauncherTemplates.vue:25` and other section headings rendered as raw `<h2>` — replaced by `<Heading level="2">` (`00-globals §G7`, `02-primitives §Heading`).
9. **Card grid for homogeneous data.** `.tpl-grid` of `.tpl-card` — homogeneous template rows belong in a `<DataGrid>` (`02-primitives §EntityCard "When NOT to use"`). Replaced as in §3.2.
10. **`▲ ▼ ×` glyph buttons** at `SessionLauncherTemplates.vue:57/63/68` — non-Lucide unicode used as iconography. Removed entirely; ordering moves to keyboard `Alt+↑/↓` on the focused grid row, and delete is `<IconButton iconName="trash-2">` in `#row-actions`.
11. **Toast spam on launch success.** Not present today, must not be added: routine success is the navigation to the new session view (MASTER §5).

---

## 8 · States

| State | Surface | Render |
|---|---|---|
| Idle | Form column | All sections rendered, advanced collapsed |
| System not ready | Top of form column | `<Banner tone="warning" iconName="triangle-alert">` with the same copy currently at `SessionLauncherView.vue:48–57`; Launch button disabled |
| Loading templates | Templates grid | `<DataGrid state="loading">` — header + 4 skeleton rows. The current `<span class="tpl-emoji">⏳</span>` skeleton is removed. |
| No templates | Templates grid | `<EmptyState iconName="bookmark-plus" title="No saved templates yet" description="Save your first launch as a template to reuse it." />` |
| Inline delete confirm | Templates grid row | Row collapses to a confirm strip — **no overlay, no blur**. Two buttons: `<Button variant="danger">Delete</Button>` `<Button variant="ghost">Cancel</Button>`. Replaces the glass overlay at css:793. |
| Launching | Launch button + form | Button shows inline spinner; form is `aria-busy="true"`; preview pane shows the resolved command unchanged |
| Launch error | Toolbar row at form footer | `<Banner tone="danger" iconName="octagon-x">` with retry; preserves form state |
| No previous launch (diff block) | Preview column | `<EmptyState size="sm" iconName="git-compare" title="No previous launch" />` |
| Quarantined legacy template | Templates grid icon cell | `<UserContentEmoji>` wrapping `legacyEmoji` (§6.2) |

---

## 9 · Accessibility

- Every `<Field>` enforces `<label for="…">`; the agent picker uses `<fieldset><legend class="sr-only">Agent</legend>` because it's a radio group.
- Launch button is a real `<button type="submit">` so `Enter` from any text-typed field triggers it (in addition to `Cmd/Ctrl+Enter`); the prompt editor explicitly intercepts `Enter` to insert a newline.
- The resolved-command block has `aria-live="polite"` so screen readers hear updates as the form changes — debounced 300ms.
- The templates `<DataGrid>` follows the keyboard model in `02-primitives §DataGrid`. Right-click context menu has a keyboard equivalent: `Shift+F10` on a focused row.
- `<UserContentEmoji>` carries `aria-hidden="true"`; the row's accessible name is the template name only.
- Light / dark parity verified — the agent-color rail must remain visible on `--canvas-default` in both modes (per the categorical-token contract in MASTER §2.4).

---

## 10 · Performance

- The templates `<DataGrid>` virtualizes when `rows.length > 100` (default in the primitive); below that, a flat render keeps interaction snappy.
- The diff-vs-last-launch block is computed lazily — only when the preview pane scrolls it into view, via the same intersection-observer pattern Settings uses for lazy panels.
- The Lucide icon catalogue (§4.1) is tree-shaken from `lucide-vue-next` at build time so the picker doesn't bloat the bundle.
- The agent-color rail is a single `box-shadow: inset` — no extra DOM nodes per option.

---

## 11 · Acceptance

### Composition

- [ ] `<SplitPane paneId="session-launcher.split">` is the only split shell — no `.split-layout` / `.panel-left` / `.panel-right` CSS in `session-launcher.css`.
- [ ] Templates render via `<DataGrid>`; `.tpl-grid` / `.tpl-card` / `.tpl-card-actions` rules are deleted.
- [ ] All section headings use `<Heading level="2">`; no `<h2 class="section-label">` literals.

### Iconography & data

- [ ] `Template.icon` is typed `LucideName | null`; the legacy string field is removed.
- [ ] Migration moves recognised emoji to Lucide names per the `00-globals §G1` table; unknown emoji land in `legacyEmoji` and render via `<UserContentEmoji>`.
- [ ] `<LucideIconPicker>` exists at `packages/ui/src/components/LucideIconPicker.vue` and is the only template-icon control.
- [ ] No emoji codepoint anywhere in `apps/desktop/src/components/sessionLauncher/**` templates or strings (`rg "[\u{1F300}-\u{1FAFF}]"` returns 0 hits).

### Glass & inline SVG

- [ ] `rg "backdrop-filter" apps/desktop/src/styles/features/session-launcher.css` returns 0 hits — the rule at line 793 is gone.
- [ ] `rg "<svg" apps/desktop/src/views/orchestration/SessionLauncherView.vue` returns 0 hits — replaced by `<Icon>`.

### Form vocabulary

- [ ] `<Field>`, `<Toggle>`, `<Select>` are imported from `@tracepilot/ui` and consumed by every section.
- [ ] The Save-as-template **Icon** field is `<LucideIconPicker>`, not a text input; the `placeholder="🚀"` literal at `SessionLauncherSaveTemplate.vue:32` is gone.
- [ ] The Save-as-template toggle label is "Save as template" (no `💾`).

### Interaction

- [ ] `Cmd/Ctrl+Enter` from anywhere in the view (including the prompt editor) triggers Launch.
- [ ] The agent-color rail uses the canonical `--agent-color-*` tokens from MASTER §2.4 — never reassigned, never inlined as hex.
- [ ] The inline delete confirm is an opaque strip, not a blurred overlay.
- [ ] Launch button is disabled when `store.isReady === false`, with the readiness `<Banner>` explaining why.

### Visual / parity

- [ ] No hex literals in `session-launcher.css` (`00-globals §G6`).
- [ ] Dark and light parity verified — agent-color rail visible in both, hairlines visible in light.
- [ ] `prefers-reduced-motion` removes the popover open/close transform; cross-fades capped at 80ms.
- [ ] No `transform: translateY` or `scale` in any `:hover` block in `session-launcher.css` (`00-globals §G4`).
