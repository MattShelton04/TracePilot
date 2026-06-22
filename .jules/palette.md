## 2025-05-15 - Pagination Accessibility
**Learning:** Found pagination components missing structural ARIA properties (`<nav>`, `aria-label="Pagination"`, `aria-current="page"`) and exposing decorative arrows to screen readers.
**Action:** Wrap pagination components in `<nav aria-label="Pagination">`, use `aria-current="page"` on the active item, and hide decorative arrows with `aria-hidden="true"` inside visually labeled buttons.
