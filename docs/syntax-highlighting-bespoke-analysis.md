# Bespoke Syntax Highlighter — Critical Analysis & Improvements

This document supersedes the abandoned Shiki migration plan. Shiki was rejected
on this branch (47× slower, +146 kB bundle). The bespoke regex highlighter in
`packages/ui/src/utils/syntax/` is good enough for TracePilot's needs **provided**
a handful of correctness bugs and one DoS-shaped cliff are fixed. This doc
records the audit and the implementation plan.

## Architectural recap

- **Per-line tokenisation.** `CodeBlock.vue` and `markdownLite.ts` call
  `highlightLine(line, language)` once **per line**. There is no multi-line
  state. `SqlResultRenderer` calls `highlightSql(sql)` on the whole query
  (which can in practice be multi-line, since the query is one string).
- **Public API:** `highlightLine`, `highlightSql`. Output is HTML-escaped text
  wrapped in `<span class="syn-…">` for safe `v-html` use.
- **Engine:** language → `TokenRule[]`; each rule is a global regex with a
  CSS class. `tokenize()` runs each rule via `regex.exec()` and uses a
  `Uint8Array` of the line's length to track which positions are already
  covered. First rule to claim a span wins.
- **CSS classes** consumed downstream (do not invent new ones):
  `keyword type string number comment func const param operator tag attr
  punct prop regex`.

## Audit (per-item triage)

Each item is **Bug** (must fix), **Polish** (worth fixing if cheap),
or **Won't-fix** (out of scope / not worth complexity).

1. **Multi-line tokens span line boundaries** — `tsRules` lists
   `/\*[\s\S]*?\*/` for block comments; `pythonRules` lists `"""…"""`;
   `rustRules` lists `r#"…"#`; `goRules` lists `` `…` ``. Confirmed by
   inspection: these never match cross-line because the caller hands one line
   at a time. Net effect: opening line is unhighlighted past `/*`, closing
   line is unhighlighted before `*/`. **Won't-fix-out-of-scope** — fixing
   would require multi-line state shared across `highlightLine` calls (i.e.
   a real architectural change). Documented here so consumers know.

2. **TS regex literal vs. division** — `/(?:\\.|[^/\\])+\/[gimsuy]*/g`
   misclassifies `a / b / c` as a regex literal. **Bug.** Fix: pair the
   pattern with a `validate` callback that requires an "expression-start"
   context (start of line, or after `=({,;:?!&|+-*/%<>~^[`, or after specific
   keywords like `return typeof instanceof in of yield await new void
   delete throw`). Implemented in `tsRules.ts::isRegexContext`.

3. **TS template literal `${expr}` interpolation** — entire `` `hello
   ${name}` `` is a single `syn-string`. **Bug** (visual regression vs
   Shiki). Fix: rule with `expand` callback that walks the literal,
   emits the string slices as `syn-string`, the `${` / `}` as `syn-punct`,
   and recursively highlights the inner expression with the TS rules.
   Brace-balanced so nested `{}` doesn't terminate early.

4. **Rust lifetimes (`'a`, `'static`) classified as string** — char-literal
   pattern `'[^'\\]'` requires both apostrophes, so two-character lifetimes
   like `'a` aren't matched there, but multi-character lifetimes also slip
   through unhighlighted (the keyword pass lacks them). Either way they're
   wrong. **Bug.** Fix: new rule `'[A-Za-z_][A-Za-z0-9_]*\b(?!')` ordered
   **before** the char-literal rule, classified as `syn-keyword` (the
   design forbids new classes). Char-literal rule unchanged.

5. **TSX/JSX support** — `tsx`/`jsx`/`vue`/`svelte` aliased to plain
   `TS_RULES`. JSX tags fall through to nothing. **Bug** (functional gap).
   Fix: dedicated `TSX_RULES` adding `</?[A-Za-z][\w.]*` and `/?>` for
   tags, `\b[a-zA-Z_][\w-]*(?=\s*=\s*["'{$])` for attribute names, on top
   of the existing TS rules.

6. **String-escape edge cases** — SQL `'it''s'` regex `'(?:''|[^'])*'`
   verified correct. Python `f"…{expr}…"` whole-classified as string —
   trade-off matches the design (line-level highlighter); leaving as-is is
   consistent. **Won't-fix-out-of-scope** for f-strings.

7. **Operator over-greediness** — `[+\-*/%=!<>&|^~?:]+` collapses `!==`
   and `&&` into one span. Each cluster is uniformly the `operator`
   colour, so visually fine. Verified no class bleed. **Won't-fix.**

8. **TS decorators `@Component(...)`** — currently no TS rule. Python has
   `@\w+`. **Polish.** Adding `@\w+` to TS costs nothing — included.

9. **CSS pseudo-classes `:hover`, `::before`** — currently swallowed by
   the `[{}();:,]` punct rule and the `[a-zA-Z-]+` prop rule. After the
   colon the keyword falls through to plain text. **Polish, deferred** —
   colour fidelity here is barely noticeable.

10. **Bash `$(cmd)`, `$'…'`** — not handled. **Won't-fix** for now.

11. **HCL aliased to TOML rules** — TOML doesn't have block syntax `block
    "label" {}` or `//` comments. **Bug** (functional gap, low severity).
    Fix: minimal dedicated rule set (comments `#`/`//`, strings, numbers,
    `true|false|null`, identifier-before-`=`, identifier-before-`{`,
    type-cased identifiers, `[…]` brackets as punct).

12. **TOML date-time literals** — RFC 3339 not highlighted. `[[a.b]]`
    table headers verified to match the existing `\[[^\]]+\]` rule
    (one regex eats both brackets due to `[^\]]+`). **Won't-fix.**

13. **YAML anchors / aliases / tags** (`&id`, `*id`, `!!type`, `!type`)
    — not handled. **Bug** (functional gap). Fix: add three rules
    classified as `syn-const` (anchors/aliases) and `syn-type` (tags).

14. **Markdown rules** are largely redundant because `markdownLite.ts`
    already parses markdown structurally. **Won't-fix**; the existing
    rules still help the rare case of highlighting inside a
    ``` ```markdown ``` fence.

15. **JSON5/JSONC** — not present in alias map; falls back to no
    highlighting. **Won't-fix** — neither is a target file type.

16. **C#/Java/Kotlin/Swift/Php aliased to TS** — wrong keyword sets.
    Currently "good enough"; adding 5 dedicated keyword tables would cost
    ~120 lines. **Won't-fix-out-of-scope.**

17. **Ruby/Perl/Lua/Elixir/Erlang aliased to Python** — even more wrong;
    same triage. **Won't-fix.**

18. **PowerShell aliased to Bash** — verb-noun cmdlets (`Get-Item`) and
    `$var:scope` ignored. **Won't-fix-out-of-scope.**

19. **VRT / snapshot tests** — none of the visual-regression tests
    consume `syntaxHighlight` output directly. Existing unit tests in
    `packages/ui/src/__tests__/syntaxHighlight.test.ts` are not snapshot-
    based. Safe to extend output without snapshot churn.

20. **ReDoS exposure** — initial audit assumed no catastrophic
    backtracking, but adding the smoke test surfaced **real** O(n²)
    behaviour on CSS / TOML / HCL prop rules: `[a-zA-Z-]+(?=\s*:)` —
    the engine matches all 100k characters then retries the lookahead
    at every starting position. **Bug.** Fix: cap repeats to `{1,80}`
    (CSS prop names rarely exceed 50 chars; TOML keys similarly). The
    test asserts < 200 ms per call against 100 kB of pathological input.

21. **`tokenize()` is `O(n_rules · n_matches)`** — irrelevant for short
    code lines. **Won't-fix.**

22. **Memoisation opportunity** — Vue re-renders cause repeated identical
    `highlightLine` calls. **Polish, high ROI.** Add a bounded LRU
    `Map<lang|line, html>` (256 entries, skip lines > 1 kB).

23. **HTML escape coverage** — `escapeHtml` does not escape `'`. Output
    is consumed via `v-html` and lands inside `<span>` text nodes (never
    inside attributes), so `'` is safe in this context. Verified by
    reading `CodeBlock.vue`'s template (the highlighted HTML is rendered
    with `v-html` between `<span class="code-line-content">` element
    bounds, no attribute-context interpolation). **Documented; no change.**

## Improvements landed in this PR (prioritised shortlist)

1. **TS regex-vs-division disambiguation** (audit item 2) — context-aware
   `validate` predicate.
2. **TS template literal interpolation** (audit item 3) — nested
   punct + recursively-highlighted expression.
3. **Rust lifetimes** (audit item 4) — new rule before the char literal.
4. **TSX/JSX awareness** (audit item 5) — additive tag/attr rules.
5. **HCL minimal rules** (audit item 11) — dedicated rule set, no
   longer aliased to TOML.
6. **YAML anchors/aliases/tags** (audit item 13) — three new rules.
7. **TS decorators** (audit item 8) — one extra rule.
8. **Bounded LRU cache** (audit item 22) — 256 entries, ~512 KB ceiling.
9. **ReDoS smoke test + fixes** (audit item 20) — performance assertion
   test plus the CSS / TOML / HCL prop-rule caps that turned a 22-second
   pathological case into a sub-millisecond one.

Out-of-scope (documented but deferred): multi-line tokens, language-specific
keyword sets for non-TS-family languages, PowerShell, JSON5/JSONC, CSS
pseudo-classes, Bash command substitution, TOML date-times, f-string
interpolation. None are user-blocking; revisit if reports come in.

## Implementation notes

- File previously 729 lines; split into `packages/ui/src/utils/syntax/`
  (`core.ts`, `keywords.ts`, `tsRules.ts`, `langRules.ts`, `index.ts`).
  The old `syntaxHighlight.ts` becomes a 7-line compat re-export and the
  allow-list entry in `scripts/check-file-sizes.mjs` is removed. Each
  new file is well under the 500-line budget.
- Cache keys are `${lang}\x00${line}`; lines longer than 1024 chars
  bypass the cache so the worst-case memory ceiling is bounded
  (256 × ~1 KB × 2 ≈ 512 KB).
- TS template literal rendering walks the body manually for brace
  balance, then re-tokenises the inner expression with `TS_RULES`.
  Recursion is bounded by source structure — a template containing a
  string `'…'` doesn't recurse further; nested templates recurse once
  per level.
