## 2024-05-18 - Modal and Drawer Close Button Accessibility
**Learning:** Structural components like Modals and Drawers often use generic `aria-label="Close"` on their close controls. This lacks explicit context for screen reader users regarding what is being closed.
**Action:** When improving accessibility for structural components, avoid generic `aria-label` attributes like "Close". Append the component type to the label (e.g., "Close drawer" or "Close dialog") to provide explicit context for screen reader users.
