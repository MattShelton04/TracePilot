## 2024-05-14 - Add aria-hidden to decorative SVGs
**Learning:** Decorative SVGs inside interactive elements like buttons need `aria-hidden="true"` to prevent screen readers from announcing them confusingly, even if the parent element already has an `aria-label`.
**Action:** Always include `aria-hidden="true"` on inner decorative elements when writing interactive components.
