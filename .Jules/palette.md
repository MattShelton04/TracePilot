## 2024-05-18 - Disabled Button UX & Accessibility
**Learning:** Adding `pointer-events: none;` to disabled buttons prevents `cursor: not-allowed;` from appearing and blocks mouse events needed for tooltip accessibility.
**Action:** Always use `cursor: not-allowed;` alongside visual indicators like `opacity: 0.5`, but omit `pointer-events: none;` to ensure tooltips still function. Update `:active` state selectors (e.g. `:active:not(:disabled)`) so disabled buttons don't animate.
