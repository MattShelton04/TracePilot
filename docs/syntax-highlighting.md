# Syntax Highlighting

> Status: evaluated in **Wave 130** (2026-04). Decision: keep the bespoke
> regex tokenizer; document it; capture shiki/highlight.js migration as a
> future improvement.

## Library choice

TracePilot does **not** depend on `highlight.js`, `shiki`, `prismjs`, or
any external syntax-highlighting library. All highlighting is handled by
a hand-rolled, regex-based tokenizer at:

- `packages/ui/src/utils/syntaxHighlight.ts`

Public API (re-exported from `@tracepilot/ui`):

```ts
import { highlightLine, highlightSql } from "@tracepilot/ui";

highlightLine(line, "typescript"); // → HTML string with .syn-* spans
highlightSql("SELECT 1");          // convenience wrapper for lang="sql"
```

### Why bespoke over a library?

| Axis | Bespoke regex | shiki | highlight.js | prismjs |
|---|---|---|---|---|
| Runtime bundle (gzip) | **~3 kB** | ~500 kB (WASM + TM grammars) | ~35 kB + per-lang | ~15 kB + per-lang |
| External deps | **0** | several | 1 | 1 |
| Correctness | "good enough" token colouring | TextMate-grade | good | good |
| Theme-aware | CSS vars (`var(--syn-keyword)`) | built-in themes | css themes | css themes |
| Languages | 33 aliases → 13 rule sets | 200+ | 190+ | 280+ |

The TracePilot UI only needs **visual polish** for assistant-rendered
code blocks and SQL result previews — not a full-fidelity editor
experience. The bundle delta of a TM-grammar-based highlighter would be
two orders of magnitude larger than the current implementation for
marginal visual gain. See `FI-w130-shiki-migration` for the conditions
that would flip this tradeoff.

## Where is the language registry?

`packages/ui/src/utils/syntaxHighlight.ts` — search for the
`LANG_RULES: Record<string, TokenRule[]>` map (near the bottom of the
file). Each entry maps a language id to a shared `TokenRule[]` array
that is built **once** at module load.

The file is on the deliberate allow-list in
`scripts/check-file-sizes.mjs` (see `packages/ui/src/utils/syntaxHighlight.ts`
entry under "TypeScript helpers") — the size comes almost entirely from
per-language keyword arrays and is expected.

## Consumers

| Consumer | Purpose |
|---|---|
| `packages/ui/src/components/renderers/CodeBlock.vue` | Primary code block renderer used by markdown + tool-result viewers. Calls `highlightLine` per line inside a Vue `computed` (so the work is memoized on the `(lines, lang)` tuple). |
| `packages/ui/src/components/renderers/SqlResultRenderer.vue` | SQL query preview above result tables. Uses `highlightSql`. |
| `packages/ui/src/utils/markdownLite.ts` | Splits fenced code blocks by newline and calls `highlightLine` per line, then joins. |

No direct callers exist outside the `@tracepilot/ui` package — all
consumers go through one of the three touch points above.

## How to add a language

1. Open `packages/ui/src/utils/syntaxHighlight.ts`.
2. If an existing rule set is a close fit (e.g., C-family → `tsRules`,
   shell-family → `shellRules`), **add an alias entry** to `LANG_RULES`:
   ```ts
   const LANG_RULES: Record<string, TokenRule[]> = {
     // …existing entries…
     zig: RUST_RULES, // close-enough for visual polish
   };
   ```
3. If the language needs bespoke tokenization:
   - Add a `FOO_KEYWORDS: string[]` const near the top.
   - Add a `fooRules(): TokenRule[]` function following the conventions
     of `tsRules`/`rustRules` (comments first, strings, numbers,
     keywords, types, funcs, operators, punct).
   - Instantiate `const FOO_RULES = fooRules();` in the
     "Rule arrays" block.
   - Register `foo: FOO_RULES` in `LANG_RULES`.
4. Add a test case in
   `packages/ui/src/__tests__/syntaxHighlight.test.ts` asserting at
   least one keyword or token class is produced.
5. Run gates:
   ```powershell
   pnpm --filter @tracepilot/ui test
   pnpm --filter @tracepilot/desktop typecheck
   pnpm --filter @tracepilot/desktop build   # confirm bundle impact
   node scripts/check-file-sizes.mjs
   ```

`detectLanguage` (file-extension → language id) lives in
`packages/ui/src/utils/languageDetection.ts`; register the new
extension there if you want `CodeBlock` to auto-pick it up from a
`filePath` prop.

## Performance notes

- **Module-level memoization.** Every `fooRules()` factory is called
  exactly once (on module load); the resulting `TokenRule[]` arrays
  (and their compiled `/g` regexes) are then re-used across every
  `highlightLine` call. `tokenize()` calls `rule.pattern.lastIndex = 0`
  before each rule so the cached regex instances are safe to share.
- **Component-level memoization.** `CodeBlock.vue` wraps the per-line
  mapping in `computed(...)`, so re-highlighting only happens when
  `(visibleRawLines, lang)` change.
- **Per-keystroke safety.** `highlightLine` is **not** called on the
  edit path — TracePilot does not embed an editor; the highlighter only
  runs on static content already committed to the view model. Any
  future editor integration should add its own debounce/memoization
  layer and should not call `highlightLine` from inside an `input`
  handler directly.
- **Token algorithm.** `tokenize()` is O(sum_of_matches × avg_match_len)
  due to the `Uint8Array used[]` overlap bitmap — acceptable for code
  blocks up to a few thousand lines. For very large blocks, the block
  itself is virtualized by `CodeBlock.vue`'s `maxLines` prop before
  reaching the tokenizer.

## Styling (`.syn-*` classes)

Token class names are defined in `syntaxHighlight.ts` and consumed by
the scoped styles in `CodeBlock.vue`:

| Class | Token kind |
|---|---|
| `syn-keyword` | language keywords |
| `syn-type` | PascalCase identifiers (types, classes) |
| `syn-string` | string and template literals |
| `syn-number` | numeric literals |
| `syn-comment` | line/block comments |
| `syn-func` | identifiers followed by `(` |
| `syn-const` | constants / shell variables |
| `syn-param` | CLI flags, params |
| `syn-operator` | operators |
| `syn-tag` | HTML/XML tag names |
| `syn-attr` | HTML/XML attributes |
| `syn-punct` | brackets, commas |
| `syn-prop` | object / CSS properties |
| `syn-regex` | regex literals |

Colours resolve through CSS vars (`--syn-keyword`, …) with hard-coded
fallbacks, so theming hooks into the existing design-token pipeline
(`packages/ui/src/styles/tokens.css`).

## See also

- `packages/ui/src/utils/markdownLite.ts` — fenced-code dispatcher.
- `packages/ui/src/utils/languageDetection.ts` — file-path → language id.
- Migrating to `shiki` or making tokenization theme-aware becomes worthwhile
  if bundled grammar coverage or theme fidelity matter more than the current
  lightweight tokenizer.
