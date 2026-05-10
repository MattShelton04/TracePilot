# 12 · Conversation Tab — primary value surface

> **Scope:** The flagship reading surface inside Session Detail (`apps/desktop/src/views/tabs/ConversationTab.vue`). Everything a user does to *understand a session* — turns, agent reasoning, tool calls, sub-agent activity, permissions, skill invocations, the objective banner — happens here. This spec defines the layout, interaction model, states, and renderer contract for that surface.
> **Inherits:** all of `00-globals.md` (hygiene), `01-chrome.md` (PageHeader, SessionTabStrip), and `02-primitives.md` (`<Heading>`, `<SplitPane>`, `<RendererShell>`, `<StatusPill>`, `<EmptyState>`, `<ToolbarRow>`).
> **Audit:** closes `design-system/audit/UI-AUDIT.md` lines 43–49 (Conversation Tab — High) and 315–321 (Conversation Tool-Call Renderers — High); contributes to lines 323–327 (Subagent Panel duplication).
> **Per-renderer specs:** each tool's body (apply-patch diff theme, shell terminal, grep table, …) is in `13-tool-renderers.md`. **This file does not specify renderer bodies — only the surface that hosts them.**
> **Sources:**
> - `apps/desktop/src/views/tabs/ConversationTab.vue`
> - `apps/desktop/src/components/conversation/ChatViewMode.vue`
> - `apps/desktop/src/components/conversation/ConversationTurnList.vue`
> - `apps/desktop/src/components/conversation/chat/ToolGroupSegment.vue`
> - `apps/desktop/src/components/conversation/chat/SubagentGroupSegment.vue`
> - `apps/desktop/src/components/conversation/SubagentPanel.vue` *(duplicate, to be removed)*
> - `packages/ui/src/components/SubagentPanel/SubagentPanel.vue` *(canonical)*
> - `packages/ui/src/components/ObjectiveBanner.vue`
> - `apps/desktop/src/components/conversation/SkillInvocationEventRow.vue`
> - `packages/ui/src/components/renderers/*` *(20+ renderers — see 13-tool-renderers.md)*

This is the densest, most-read surface in TracePilot. It is the screen the user spends the most time on and the one most likely to feel "AI-vibe-coded" today (emoji headers, hand-rolled frames, glass blur). The redesign target is a calm, three-pane reading surface in the spirit of **Datadog's APM trace viewer** and **Linear's issue thread** — content-first, keyboard-first, zero decoration.

---

## 12.1 · Information architecture

A session conversation is a **time-ordered stream of turns**. Each turn is a heterogeneous group of events that this view must render coherently:

| Element | Source | Visual archetype |
|---|---|---|
| **Turn** | top-level grouping (one user prompt → one assistant cycle) | collapsible group, mono turn-id, timestamp |
| **User message** | `user_message` event | left-aligned block, `--accent-fg` rail |
| **Agent reasoning** | `reasoning` block | collapsed by default, Lucide `brain`, italic body |
| **Tool call** | `<RendererShell>` from `packages/ui/src/components/renderers/*` | header strip + body, status colored left-edge |
| **Sub-agent group** | `SubagentGroupSegment` → expands to `<SubagentPanel>` | nested column with `--agent-color-*` rail |
| **Skill invocation** | `SkillInvocationEventRow` | single row, Lucide `zap`, `<StatusPill>` |
| **Permission event** | `PermissionEventRow` | inline banner, Lucide `lock`, `--warning-*` |
| **Gap indicator** | derived (≥ 30s of dead air between events) | hairline + `… 47s` mono label |
| **Objective banner** | `<ObjectiveBanner>` (top of view) | sticky banner, Lucide `target`, **not color-only** |

> **Per-renderer specs live in `13-tool-renderers.md`.** This file declares only that every tool call renders inside `<RendererShell>` (per `02-primitives §RendererShell`) — no exceptions, no hand-rolled frames.

---

## 12.2 · Layout

The view is a **three-region thread layout**: a thin **left mini-timeline rail**, the **main turn column**, and a **right inspector pane** that opens when a tool call is selected. The split between main and inspector uses `<SplitPane paneId="conversation:inspector" persist>`. The left rail is a fixed 40px gutter inside the main column — not a third pane — so it scrolls *with* the conversation, not against it.

```
┌── PageHeader (01-chrome §1.4) ────────────────────────────────────────────────────────────────┐
│ Sessions › 4eaa…b91c › Conversation                                                            │
│ [target] feat: refactor auth flow             [Active 12s ago]   [↻] [Find ⌘F] [Inspector ⌘I] │
│ ──────────────────────────────────────────────────────────────────────────────────────────────│
│ [#toolbar slot — ConversationViewSwitcher (chat | timeline) · density · jump-to-error]        │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┬─────────────────────────────┐
│ ┌── ObjectiveBanner ────────────────────────────────────────┐    │  Inspector — edit_file       │
│ │ [target] Objective                                         │    │  ──────────────────────────  │
│ │ Refactor JWT signing to use rotated keys.                  │    │  Tool      edit_file         │
│ └────────────────────────────────────────────────────────────┘    │  Status    success           │
│                                                                    │  Duration  124 ms (mono)     │
│ ┌rail─┬── Turn 1 · 14:32:08 · 4.2s ──────────────────[▾]────┐    │  Tokens    312 in / 88 out   │
│ │  ●  │  [user] "Find the JWT signing code"                  │    │  ──────────────────────────  │
│ │  │  │                                                       │    │  ┌─ args ─┐ ┌─ result ─┐    │
│ │  ○  │  [brain] reasoning · 240 tokens · expand [▸]          │    │  ┌─ raw ─┐                  │
│ │  │  │                                                       │    │                              │
│ │  ◆  │  ┌─[search] grep · ✓ 92ms · auth/*.ts ─────┐          │    │   path: packages/ui/...      │
│ │  │  │  │  12 matches across 4 files               │ [open]   │    │   start_line: 42             │
│ │  │  │  └────────────────────────────────────────┘          │    │   end_line:   58             │
│ │  ◆  │  ┌─[edit] edit_file · ✓ 124ms · …Btn.vue ─┐ [open]   │ ←── │   …                          │
│ │  │  │  │  +12 / -3                                │  active  │    │                              │
│ │  │  │  └────────────────────────────────────────┘          │    │   ── hairline ──             │
│ │  │  │                                                       │    │   ⎘ Copy   ↻ Retry           │
│ │  ◇  │  [zap] skill: stylelint · ✓ 38ms                      │    │                              │
│ │     │                                                       │    │  Errors                      │
│ │ ─── │  … 47s gap                                             │    │  (none)                      │
│ │     │                                                       │    │                              │
│ ├rail─┼── Turn 2 · 14:33:01 · 8.1s ──────────────────[▾]────┐    │                              │
│ │  ●  │  [user] "Now run the tests"                           │    │                              │
│ │  ▣  │  ┌─[bot] subagent: explore · running ─────┐ [▸]      │    │                              │
│ │  │  │  │  3 tool calls · 2.1s elapsed            │           │    │                              │
│ │  │  │  └────────────────────────────────────────┘          │    │                              │
│ └─────┴──────────────────────────────────────────────────────┘    │                              │
│                                                                    │                              │
│                                          [scroll-to-top FAB ↑]    │                              │
└──────────────────────────────────────────────────────────────────┴─────────────────────────────┘
   left rail = 40px gutter                                            inspector = 360–520px (resizable, persisted)
   main column = flex                                                 closed by default; toggles on tool-call click
```

### Region-by-region rules

**Left mini-timeline rail (40px gutter, in main column).**
- One **dot per significant event** in the active scroll viewport: filled dot for user message (`--accent-emphasis`), open ring for reasoning, diamond for tool call (toned by status), hollow diamond for skill invocation, square for sub-agent group entry. Gaps render a 1px vertical break + `…` glyph. **Color is paired with shape** (G2 / `00-globals §G6`) — never tone-only.
- Acts as a scroll affordance: clicking a dot scrolls its event into view in the main column and selects it.
- Uses `position: sticky; top: 0` so the dot column tracks scroll. It is **not** a separate pane — it's a CSS column inside each turn group.

**Main column (flex).**
- Vertically scrolling thread of turn groups. Each group has a sticky 32px sub-header with turn id (mono), wall-clock time, total duration, and a chevron toggle.
- Content blocks compose `<RendererShell>` (every tool call), `<ObjectiveBanner>`, `<StatusPill>`, and plain prose blocks for user/reasoning text.
- Max content width inside the column is **88ch** for prose and **full-width** for tool renderers (renderers manage their own internal density).
- The **Compact** density toggle (per `00-globals §G8`) shrinks turn padding from 16px to 12px and tool-call header height from 36px to 32px.

**Right inspector pane (`<SplitPane>` second pane).**
- Closed by default. Opens when the user clicks a tool call (or presses `l` on a focused tool call), or via the toolbar `[Inspector ⌘I]` toggle.
- Width is resizable (`min: 320px`, `max: 720px`, `initial: 420px`). State persists via `tracepilot:splitpane:conversation:inspector` (per `02-primitives §SplitPane`).
- Open/closed state persists per session under `tracepilot:conversation:inspector:<sessionId>` so a user who prefers the inspector closed for a given session keeps it that way on revisit.
- Renders **only** for tool calls. User messages, reasoning, and sub-agent panels do not populate the inspector — they expand inline in the main column.

---

## 12.3 · Tokens used

This view introduces **no new tokens**. Everything resolves to existing variables in `packages/ui/src/styles/tokens.css`:

| Concern | Token |
|---|---|
| Page background | `--canvas-default` |
| Sticky turn sub-header | `--canvas-subtle`, `border-bottom: 1px solid var(--border-subtle)` |
| Inspector pane background | `--canvas-raised`, `border-left: 1px solid var(--border-subtle)` |
| Tool-call frame | inherited from `<RendererShell>` (`--canvas-subtle` body) |
| Turn-id, durations, tokens, paths | `--font-mono` + `font-feature-settings: 'tnum' 1` |
| Rail dot — user | `--accent-emphasis` |
| Rail dot — reasoning | `--text-tertiary` |
| Rail diamond — tool success | `--success-fg` |
| Rail diamond — tool warning | `--warning-fg` |
| Rail diamond — tool error | `--danger-fg` |
| Rail square — sub-agent | `--agent-color-*` (per `MASTER §2.4`) |
| Gap indicator label | `--text-tertiary`, `--font-mono` |
| Objective banner | `--canvas-subtle` bg, `--accent-fg` icon, **icon + label** (never tint-only) |
| Selected tool call | `--accent-subtle` background, `inset 2px 0 0 0 var(--accent-emphasis)` left rail |
| Scroll-to-top FAB | `--canvas-overlay` bg, `--border-default`, `--shadow-md` (no blur — see §12.10) |

> No hex literals. No new `--gradient-*`. The objective banner does **not** use `linear-gradient` — it uses a single `--canvas-subtle` panel with the Lucide `target` icon as the differentiator (closes the audit's "color-only differentiation" finding for ObjectiveBanner vs system messages).

---

## 12.4 · Component contracts

The conversation tab is a composition, not an implementation. Every visual element delegates to a primitive.

| Region / element | Primitive | Notes |
|---|---|---|
| Header (title, status, actions) | `<PageHeader>` (`01-chrome §1.4`) | `iconName="messages-square"`, `status` reflects session running state |
| View-mode switcher (chat / timeline) | `<ToolbarRow>` (`02-primitives §ToolbarRow`) `#toolbar` slot | segmented control inside `#left` |
| Main / inspector split | `<SplitPane paneId="conversation:inspector" persist :collapsible="'second'">` | `Alt+0` collapses inspector |
| Tool call (every renderer) | `<RendererShell>` (`02-primitives §RendererShell`) | **mandatory.** No tool call may render its own outer frame |
| Status pill (turn header, sub-agent badge) | `<StatusPill>` | per-tone tokens; never color-only |
| Turn group / section title | `<Heading level="3" mono>` for turn id | mono so timestamps / ids align |
| Empty state (no turns, viewer with no session) | `<EmptyState>` | icon `messages-square`, primary action `Start a session` |
| Find-in-conversation overlay | inline `<ToolbarRow variant="inline" sticky>` pinned to top of column | renders only when active |
| Sub-agent panel | **`packages/ui/src/components/SubagentPanel/SubagentPanel.vue`** | canonical |

### Sub-agent panel consolidation (closes audit lines 323–327)

There are currently two `SubagentPanel` components:
- `packages/ui/src/components/SubagentPanel/SubagentPanel.vue` — **canonical**, exported from `@tracepilot/ui`.
- `apps/desktop/src/components/conversation/SubagentPanel.vue` — duplicate; delete.

Migration:
1. Update `apps/desktop/src/components/conversation/SubagentGroupSegment.vue` to import from `@tracepilot/ui`.
2. Add a `name: keyof AgentColorMap` prop to the canonical panel so it can resolve `--agent-color-{main|explore|general-purpose|code-review|rubber-duck|task}` for its left rail and badge.
3. Add a Biome / ESLint rule (lives with the existing duplicate-component lint suite from `02-primitives`):
   ```
   tracepilot/no-local-reimplementation:
     - SubagentPanel.vue must only exist in packages/ui/src/components/SubagentPanel/
   ```
4. Delete the desktop duplicate; verify no double-rendering by running `ConversationTurnList.test.ts`.

### Renderer-shell delegation (closes audit lines 315–321)

Every renderer in `packages/ui/src/components/renderers/` is migrated behind `<RendererShell>`:

```
ApplyPatchRenderer · EditDiffRenderer · ShellOutputRenderer ·
GrepResultRenderer · GlobTreeRenderer · ViewCodeRenderer ·
WebSearchRenderer · SqlResultRenderer · AskUserRenderer ·
PlainTextRenderer · ReportIntentRenderer · StoreMemoryRenderer ·
CreateFileRenderer · ToolResultRenderer · ToolErrorDisplay
```

A renderer that defines `.renderer-frame`, `.tool-card`, its own border, or its own header strip outside `<RendererShell>` fails lint. Per-renderer body specs (icon name, segmented tabs, syntax theme) live in `13-tool-renderers.md`.

---

## 12.5 · Interaction model

### Keyboard

The conversation tab registers the following shortcuts via the `useShortcut(...)` API from `01-chrome §1.7` so they appear in the `?` overlay under "Active View":

| Key | Action |
|---|---|
| `j` / `k` | next / previous **turn** (scrolls turn into view, focuses turn header) |
| `n` / `p` | next / previous **tool call** within the current focus context (turn-scoped if a turn is focused, document-scoped otherwise) |
| `J` / `K` | next / previous **error or warning** tool call (severity jump) |
| `e` | expand / collapse the focused turn |
| `E` | expand / collapse **all** turns |
| `r` | retry the focused tool call's full-result fetch (only when a `<RendererShell>` with `onRetry` is focused) |
| `c` | copy the focused tool call's `copyText` to clipboard |
| `l` | open inspector for focused tool call |
| `Esc` | close inspector (when open and focused); else close find overlay; else clear selection |
| `gg` | jump to first turn |
| `G` | jump to last turn (and re-engage scroll-lock-to-bottom) |
| `Cmd/Ctrl+F` | open find-in-conversation overlay (scoped — does **not** trigger browser/native find) |
| `Cmd/Ctrl+I` | toggle inspector pane |
| `Cmd/Ctrl+End` | scroll to bottom + lock |
| `?` | global kbd-help overlay (already from chrome) |

Every mouse interaction has a keyboard equivalent. There is no mouse-only path to inspector, expand, retry, copy, or jump-to-error.

### Find-in-conversation (`Cmd/Ctrl+F`)

A scoped `Cmd+F` overlay anchored to the top of the main column. Searches **rendered text** of the current session's turns: user messages, reasoning, tool args summaries, tool results (loaded), and sub-agent activity. **Does not** trigger the browser/native find dialog when the conversation tab is focused.

- Input: `<ToolbarRow variant="inline" sticky>` with a single text input + match counter (`3 / 17`) + prev/next/close.
- Matches highlight in-line with `--warning-subtle` background; current match gets `--warning-emphasis` outline.
- `Enter` / `↓` next match, `Shift+Enter` / `↑` previous match, `Esc` closes.
- Debounce 120ms. Empty query clears highlights.
- Persists last query for 30s after close (parity with the global Search Palette).

### Jump-to-last-error

A toolbar affordance — Lucide `alert-octagon`, label "Jump to error" — appears in the `<ToolbarRow>` `#right` slot **only when the session has at least one tool call with status `error` or `warning`**. Clicking (or pressing `J`) scrolls the most recent failed tool call into view, focuses it, and opens the inspector if any.

### Deep-link

`?turn=<turnId>&event=<eventId>`:
- On mount, the `useConversationDeepLinkScroll` composable scrolls the targeted turn / event into view, expands its parent turn group, and (if `event` is a tool call) opens the inspector.
- The hash is updated on `j/k/n/p` so a user can copy the URL and share their cursor position.

### Inspector behaviour

- Click a tool call's header → inspector opens (or updates if already open) with that tool's args / result / timing / errors.
- The selected tool call gets the `aria-selected="true"` left rail (`--accent-emphasis`).
- `Cmd/Ctrl+I` or `Esc` closes the inspector.
- Closed state and pane width both persist per session (see §12.2 inspector rules).

---

## 12.6 · States

| State | Trigger | Treatment |
|---|---|---|
| **Empty** | Session exists but has zero turns (e.g. just-launched session) | `<EmptyState iconName="messages-square" title="No turns yet" description="The session is ready. Send the first message from the steering panel below." />` |
| **Loading-turns** | Initial fetch | 3 skeleton turn groups: gray header bar (`--surface-tertiary` 50%), 2 skeleton block rows. Reserve full layout dimensions so renderers don't jump on arrival. |
| **Partial / streaming** | Live session with `is_running` true | Last turn renders a pulsing `<StatusPill tone="accent" iconName="loader-2" label="Running" />` in its header. New events fade-in (180ms opacity, no transform). The view is `aria-live="polite"` so SRs announce new tool calls. |
| **Error-on-fetch** | `useSessionTabLoader` returns error | Top-of-column `<ErrorAlert>` with retry button. Existing turns (if any) remain visible. Never replace the whole view with the error. |
| **Tool-result fetch error** | `useToolResultLoader` `failedResults.has(eventId)` | `<RendererShell>` for that tool shows `error` status; footer surfaces `↻ Retry` (wired to `onRetry`). |
| **Scroll-lock-to-bottom** | `useAutoScroll` reports `isLockedToBottom` | When locked, new events scroll-into-view automatically. The instant the user scrolls up, lock disengages and the **scroll-to-top FAB** flips to a **scroll-to-bottom FAB** (`--accent-emphasis`, Lucide `arrow-down-to-line`). Pressing `G` or clicking re-engages lock. |
| **Scroll-to-top FAB** | `showScrollToTop && hasOverflow` | 40×40 circular button at the top-right of the main column (not over the inspector). Lucide `arrow-up-to-line`. **No `backdrop-filter`** — uses `--canvas-overlay` + `--shadow-md`. `z-index: var(--z-fab)`. |
| **Viewer / no session** | `useWindowRole().isViewer()` and no session loaded | `<EmptyState iconName="eye" title="Viewer ready" description="Open a session to read its conversation." />` |

---

## 12.7 · Motion

All durations come from `00-globals §G5` (120 / 180 / 220ms) with `cubic-bezier(0.2, 0.6, 0.2, 1)` easing.

| Motion | Duration | Property |
|---|---|---|
| Turn group expand / collapse | **180ms** | `opacity` + `transform: translateY(-4px → 0)` on the body; **never** `height` (causes layout thrash on dense renderers) |
| Inspector slide in / out | **220ms** | `transform: translateX(...)` on the second pane |
| Tool-call selection rail | **120ms** | `box-shadow` color transition only |
| Find-overlay enter | **180ms** | opacity |
| Streaming new event | **180ms** | opacity 0 → 1 only |
| Scroll-to-top FAB show / hide | **120ms** | opacity |

`prefers-reduced-motion: reduce` collapses all of the above to instant cross-fades capped at 80ms — including the inspector slide and turn expansion. The streaming new-event fade falls back to instant insertion.

There is **no auto-playing decoration** anywhere in this view.

---

## 12.8 · Accessibility

- The main column carries `role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation"`. Streaming inserts are announced; expanding an existing turn is **not** announced (it's a user action, not a new event).
- Each turn group is a `<section aria-labelledby="turn-<id>-title">`.
- Each tool call is a **landmark**: `role="article" aria-labelledby="tool-<eventId>-title"` so screen-reader users can navigate tool calls with the rotor.
- The left mini-timeline rail uses `role="presentation"` because the dots are a *redundant* affordance — every dot's underlying event is already in the main column with full semantics. Dots are clickable buttons with `aria-label="Jump to <event-summary>"`.
- The inspector pane is `<aside aria-label="Tool call inspector">`. When closed, it is `aria-hidden="true"` and removed from the tab order. When open it is **not** a focus trap (this isn't a modal); `Esc` closes it.
- Severity in the rail and in `<RendererShell>` headers is **always icon + tone color** — never tone-only (`00-globals §G6` / `MASTER §5`).
- Find-in-conversation announces match count via a polite live region: "17 matches" debounced 500ms.
- Every keyboard shortcut from §12.5 has a visible hint either in the `?` overlay or as a tooltip `<kbd>` chip on the corresponding affordance. No hidden bindings.
- Color contrast: tool-call status text on `--canvas-subtle` and selected-row text on `--accent-subtle` both meet 4.5:1 in dark and light modes (validated against `tokens.css`).

---

## 12.9 · Anti-patterns to remove

These are concrete diffs the implementation PR must land. Each is referenced from the audit.

1. **Emoji `🎯` for "intent / objective" headers** — `apps/desktop/src/components/conversation/chat/ToolGroupSegment.vue:82`. Replace with Lucide `target` via `<Icon name="target" size="16" />` (`00-globals §G1` migration table).
2. **Emoji `⚡` for sub-agent activity** — `apps/desktop/src/components/conversation/chat/SubagentGroupSegment.vue:23`. Replace with Lucide `bot` (sub-agent identity) **paired with** `--agent-color-*` left rail; use `zap` only for skill invocations.
3. **Emoji `⚡` for skill invocations** — `apps/desktop/src/components/conversation/SkillInvocationEventRow.vue:98`. Replace with Lucide `zap` via the canonical `<Icon>` wrapper.
4. **Reasoning header without a glyph** (currently text-only, looks like a system message). Add Lucide `brain` 16px in `--text-tertiary`. Closes the "color-only differentiation" subnote in audit line 47.
5. **`backdrop-filter: blur(8px)` on `.scroll-fab`** — `apps/desktop/src/views/tabs/ConversationTab.vue:298`. Delete the line. Use `--canvas-overlay` + `--shadow-md` instead (`00-globals §G2`).
6. **Per-renderer hand-rolled frames.** Any of the renderers listed in §12.4 that defines its own outer border / corner radius / header strip — delete that markup, wrap the renderer body in `<RendererShell>`, pass `iconName` / `status` / `durationMs` / `primaryHint` props. (Bodies move into `#default`.) Closes audit lines 315–321 and `02-primitives §RendererShell`.
7. **`<ObjectiveBanner>` differentiating only by tint.** The current banner is visually adjacent to system messages. Required treatment:
   - Lucide `target` 20px in `--accent-fg` at the start of the banner.
   - The label "**Objective**" rendered as `<Heading level="3">` mono *off* — sans, not mono — to read as a label, not an id.
   - `--canvas-subtle` background, `--border-subtle` 1px hairline, **no gradient fill** (`00-globals §G3`).
   - Sticky to the top of the main column with `top: 0; z-index: 1` (below `--z-header`).
8. **Duplicate `SubagentPanel.vue`** in `apps/desktop/src/components/conversation/`. Delete; import the canonical `packages/ui/src/components/SubagentPanel/SubagentPanel.vue`. (See §12.4.)
9. **Inline emoji in `<EmptyState>` calls** (any file). The audit flagged `📊` in timeline views — sweep this view too: empty states use `<EmptyState iconName="…">` only, never an emoji string.
10. **`transform: scale()` / `translateY()` on `.tool-call:hover`** if present. Hover changes `background-color` and `border-color` only (`00-globals §G4`).

---

## 12.10 · Acceptance checklist

### Layout
- [ ] Three-region layout renders: left rail (40px gutter inside main), main column (flex), inspector (resizable right pane).
- [ ] `<SplitPane paneId="conversation:inspector">` persists width across reloads.
- [ ] Inspector open / closed state persists per session under `tracepilot:conversation:inspector:<sessionId>`.
- [ ] Inspector is closed by default for a never-opened session.
- [ ] Compact density toggle (G8) reduces turn padding from 16px → 12px and tool-call header from 36px → 32px; persists per view.
- [ ] No nested bordered "frame soup" — every tool call has exactly one outer frame, drawn by `<RendererShell>`.

### Primitives & contracts
- [ ] All tool renderers in `packages/ui/src/components/renderers/*` compose `<RendererShell>`. Lint passes (`tracepilot/no-local-reimplementation`).
- [ ] Sub-agent panels import from `@tracepilot/ui`; the desktop duplicate file is deleted.
- [ ] `<ObjectiveBanner>` uses Lucide `target` + label, no gradient, no color-only differentiation.
- [ ] `<StatusPill>` is the only tool-call status renderer; no inline colored `<span>` pills.
- [ ] No raw `<h1>`–`<h6>` in this view's templates; use `<Heading>`.

### Iconography (closes CC-1 in this view)
- [ ] `🎯` removed from `ToolGroupSegment.vue`; replaced with Lucide `target`.
- [ ] `⚡` removed from `SubagentGroupSegment.vue`; replaced with Lucide `bot` + agent color rail.
- [ ] `⚡` removed from `SkillInvocationEventRow.vue`; replaced with Lucide `zap`.
- [ ] Reasoning blocks render Lucide `brain`.
- [ ] No emoji codepoints in any conversation-tab `<template>` block (`rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src/views/tabs/ConversationTab.vue apps/desktop/src/components/conversation/` returns 0).

### Hygiene (closes CC-2, CC-3, CC-11, CC-12 in this view)
- [ ] No `backdrop-filter` anywhere in `ConversationTab.vue` or its descendants.
- [ ] No `linear-gradient` on any panel, banner, or row.
- [ ] No hex literals; every color comes from a token.
- [ ] No `transform` on `:hover` for any row, tool call, or rail dot.

### Interaction
- [ ] `j/k`, `n/p`, `J/K`, `e/E`, `r`, `c`, `l`, `Esc`, `gg`, `G`, `Cmd/Ctrl+F`, `Cmd/Ctrl+I`, `Cmd/Ctrl+End` all bound and discoverable in the `?` overlay under "Active View".
- [ ] `Cmd/Ctrl+F` opens the scoped find overlay and does **not** trigger the native browser find.
- [ ] "Jump to error" affordance appears only when the session has at least one error/warning tool call; pressing `J` scrolls + focuses it.
- [ ] Deep-link `?turn=&event=` scrolls, expands, selects, and (for tool calls) opens the inspector.
- [ ] `?turn`/`?event` query string updates as the user navigates with `j/k/n/p` (replaceState, not pushState — no history pollution).
- [ ] Mini-timeline rail dots are clickable and have `aria-label`; full keyboard parity exists via `j/k`.

### States
- [ ] Empty state renders `<EmptyState iconName="messages-square">` with a primary action.
- [ ] Loading skeleton reserves layout (no content jump on first turn arrival).
- [ ] Streaming events fade in 180ms / opacity-only; no layout shift.
- [ ] Error-on-fetch shows an inline `<ErrorAlert>` at the top of the column without replacing existing turns.
- [ ] Scroll-lock-to-bottom engages on initial load and after `G`; disengages on user scroll-up.
- [ ] Scroll-FAB flips between scroll-up and scroll-down based on lock state; `prefers-reduced-motion` removes the flip animation.

### Motion
- [ ] All transitions are 120 / 180 / 220ms with the global easing curve.
- [ ] Turn expand / collapse animates `opacity` + `translateY` only — never `height`.
- [ ] `prefers-reduced-motion: reduce` reduces all motion to ≤ 80ms cross-fades (verified by toggling OS setting).

### Accessibility
- [ ] Main column has `role="log" aria-live="polite"`.
- [ ] Each tool call is an `aria-labelledby` landmark navigable by SR rotor.
- [ ] Inspector is `aria-hidden` when closed; not a focus trap when open.
- [ ] Severity is always icon + tone, never tone alone.
- [ ] Find overlay announces "N matches" via a polite live region.
- [ ] Tab order matches visual order through PageHeader → toolbar → main column → inspector.
- [ ] Body text contrast ≥ 4.5:1 on every surface (selected, hover, default) in both light and dark.

### Performance
- [ ] Conversation with 200 turns and 1 000 tool calls scrolls at 60fps on a 1440p panel.
- [ ] Renderers virtualize where appropriate (`13-tool-renderers.md` defines per-renderer thresholds).
- [ ] `useToolResultLoader` cache survives view-mode toggles (instantiated in `ConversationTab.vue`, not in child).

### Cross-references
- [ ] References `00-globals §G1, G2, G3, G4, G5, G6, G8` for hygiene.
- [ ] References `01-chrome §1.4` for the page header and `§1.7` for the `?` overlay.
- [ ] References `02-primitives §RendererShell, §SplitPane, §StatusPill, §EmptyState, §Heading, §ToolbarRow`.
- [ ] Per-renderer specifics (icon names, syntax themes, segmented tabs) live in `13-tool-renderers.md` — this file does not duplicate them.

---

*This is the flagship surface. Treat every deviation from this spec as a regression on the most-read screen in the app.*
