## 2024-05-10 - Decorative ✕ character screen reader accessibility
**Learning:** Purely decorative characters like '✕' inside interactive elements (like buttons) must be wrapped with `<span aria-hidden="true">` to prevent screen readers from announcing them confusingly, even when the parent has an explicit `aria-label`.
**Action:** Always wrap decorative unicode symbols (e.g. '✕') in `<span aria-hidden="true">` when used inside buttons or spans with click handlers.
