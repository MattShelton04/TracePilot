## 2024-05-24 - Specific ARIA labels for structural components
**Learning:** Generic `aria-label="Close"` on structural components like Modals or Drawers can lack context for screen reader users when multiple closeable elements are present.
**Action:** Always append the component type to the label (e.g., 'Close drawer' or 'Close modal') to provide explicit context.
