## 2025-02-28 - Component Accessibility
**Learning:** Drawers and Modals were using generic 'Close' labels for their close buttons.
**Action:** When improving accessibility for structural components (like Drawers or Modals), avoid generic aria-label attributes like 'Close' on their controls. Append the component type to the label (e.g., 'Close drawer') to provide explicit context for screen reader users.
