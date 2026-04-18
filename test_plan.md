1. **Identify the UX Opportunity:** Add an appropriate visual representation for disabled buttons (`.btn:disabled`). Currently, there are many custom rules for `:disabled` buttons scattered across different feature CSS files (`mcp-server-detail.css`, `config-injector.css`, `agent-tree.css`, `session-launcher.css`, etc.). We can unify this by adding a `.btn:disabled` state directly to the core `components.css` which will provide immediate visual feedback (like reduced opacity and a `not-allowed` cursor) across the entire application for disabled states, significantly improving accessibility and interaction clarity.
2. **Implementation Strategy:**
   - Modify `apps/desktop/src/styles/components.css`.
   - Add `.btn:disabled` styles (e.g., `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`).
   - Run tests to verify no regressions.
3. **Pre-commit checks:** Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
