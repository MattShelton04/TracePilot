## 2024-05-24 - Specific ARIA labels for structural UI
**Learning:** When improving accessibility for structural components (like Drawers or Modals), using generic aria-label attributes like 'Close' on controls provides insufficient context for screen reader users.
**Action:** Always append the component type to the label (e.g., 'Close drawer', 'Close modal') to provide explicit context. Ensure associated component tests are updated concurrently to prevent query failures.
