## 2024-05-20 - Decorative Unicode Characters in Buttons
**Learning:** Screen readers often announce raw unicode symbols like '✕' or '×' literally (e.g., "multiply" or "times") even when the parent button has an `aria-label`.
**Action:** Always wrap purely decorative unicode characters inside interactive elements with `<span aria-hidden="true">` to prevent confusing screen reader announcements.
