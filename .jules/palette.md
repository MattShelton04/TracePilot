## 2024-05-30 - Improving Context for Structural Components
**Learning:** When improving accessibility for structural components (like Drawers or Modals), using generic aria-label attributes like 'Close' on their controls lacks context for screen reader users.
**Action:** Append the component type to the label (e.g., 'Close drawer' or 'Close modal') to provide explicit context. Ensure associated tests are also updated.
