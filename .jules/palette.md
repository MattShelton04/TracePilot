## 2024-05-14 - Contextual Close Labels
**Learning:** Generic `aria-label="Close"` attributes on structural components like Modals and Drawers lack sufficient context for screen reader users, making navigation confusing when multiple overlays might exist or be recently closed.
**Action:** Append the component type to the label (e.g., `aria-label="Close modal"` or `aria-label="Close drawer"`) and ensure corresponding unit tests querying by these labels are concurrently updated.
