## 2024-05-16 - Accessible Pagination Components
**Learning:** Found pagination controls without proper accessible wrappers (`<nav>`) and aria attributes.
**Action:** Always wrap pagination components in `<nav aria-label="Pagination">`, set `aria-current="page"` on the active page, and hide decorative characters with `aria-hidden="true"`.
