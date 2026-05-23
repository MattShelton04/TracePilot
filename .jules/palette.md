## 2024-05-24 - Contextual ARIA labels on structural controls
**Learning:** Generic `aria-label="Close"` on structural components like Drawers and Modals lacks context for screen reader users when multiple overlay elements might be present on screen.
**Action:** Always append the component type to the label (e.g., 'Close drawer', 'Close modal') to provide explicit context.
