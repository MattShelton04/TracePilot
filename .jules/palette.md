## 2024-05-24 - Contextual Aria Labels for Structural Components
**Learning:** Generic `aria-label="Close"` on structural components like Modals and Drawers lacks context for screen reader users when multiple actionable components may be present.
**Action:** Always append the component type to the aria-label (e.g., "Close modal", "Close drawer") to provide clear explicit context.
