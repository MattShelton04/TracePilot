## 2026-05-17 - Improve accessibility of modal/drawer close buttons

**Learning:** Generic `aria-label="Close"` on structural components like `ModalDialog` and `Drawer` lack context for screen reader users, especially when multiple overlays might be present. Also, raw unicode characters (like `×` and `✕`) in close buttons are often announced confusingly by screen readers even when an `aria-label` is present, and should be wrapped in `<span aria-hidden="true">`.

**Action:** Update structural components to use contextual `aria-label`s (e.g., `"Close modal"` or `"Close drawer"`). For raw unicode icons in close buttons, wrap them in `<span aria-hidden="true">` to prevent screen reader interference.
