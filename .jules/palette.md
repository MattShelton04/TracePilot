## 2025-02-14 - Screen reader accessibility for purely decorative elements
**Learning:** Decorative unicode characters like '✕' and '×' in interactive elements, even when an `aria-label` is present, can confuse screen readers if not properly hidden using `aria-hidden="true"`.
**Action:** Always wrap raw unicode symbols or decorative SVGs inside buttons with `<span aria-hidden="true">` or `<svg aria-hidden="true">` respectively to prevent screen readers from reading them incorrectly.
