## 2024-05-21 - Specific ARIA labels for structural components
**Learning:** Structural components like Modals and Drawers should use specific ARIA labels for their close buttons (e.g., 'Close modal', 'Close drawer') rather than a generic 'Close'. This provides explicit context for screen reader users so they know what they are closing.
**Action:** Always append the component type to the close button's aria-label in structural UI components, and remember to concurrently update associated component tests that query these elements.
