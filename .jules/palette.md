## 2024-05-16 - Avoid Generic ARIA Labels on Structural Components
**Learning:** Structural UI components like Modals and Drawers often use generic `aria-label="Close"` on their close buttons. This lacks context when navigating by screen reader.
**Action:** Always append the structural component type to the aria-label (e.g., `aria-label="Close drawer"`, `aria-label="Close dialog"`) to provide clear, contextual cues for assistive technology users.
