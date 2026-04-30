## 2024-05-14 - Missing aria-hidden on decorative SVGs
**Learning:** Many SVGs used for decorative icons inside interactive elements or links are missing `aria-hidden="true"`. This is a common pattern across many components (`AppSidebar.vue`, `SkillEditorMarkdownEditor.vue`, etc.), leading to screen readers announcing confusing SVG source data or duplicate content instead of reading the provided `aria-label`.
**Action:** Always verify decorative SVGs have `aria-hidden="true"` when adding `aria-label` to parent elements, and when reviewing UI components.
