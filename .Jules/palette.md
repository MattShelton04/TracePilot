## 2024-05-18 - Tooltip VS Aria-labels for icon-only buttons
**Learning:** Even if an icon-only button has a `title` attribute, an explicit `aria-label` is recommended for robust screen reader support. Wait, `title` can provide an accessible name but it can be inconsistent across browsers and assistive technologies. Explicit `aria-label` is always preferred.
**Action:** Always add an explicit `aria-label` to icon-only buttons, even if a `title` attribute is already present for visual tooltips.
