## 2024-05-23 - Accessibility rules for close buttons
**Learning:** When improving accessibility for structural components (like Drawers or Modals), avoid generic `aria-label` attributes like 'Close' on their controls. Append the component type to the label (e.g., 'Close drawer') to provide explicit context for screen reader users. Also make sure to update related tests to reflect the updated aria label.
**Action:** When updating a close button in a structural component, use a specific `aria-label` like "Close modal" or "Close drawer".
