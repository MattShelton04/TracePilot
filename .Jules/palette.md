
## 2024-04-26 - [Decorative Characters require ARIA treatment]
**Learning:** Purely decorative characters (like raw unicode symbols "✕" or decorative SVGs) inside interactive elements (like buttons) must be wrapped with `<span aria-hidden="true">` or `<svg aria-hidden="true">`. This prevents screen readers from announcing them confusingly, even when the parent element has an explicit `aria-label`.
**Action:** When working on buttons and other interactive elements, ensure any visual icon, svg, or unicode character is marked with `aria-hidden="true"` to provide a clean screen reader experience.
