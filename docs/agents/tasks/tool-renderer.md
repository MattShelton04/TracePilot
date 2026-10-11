# Tool renderer

Improve how one Copilot CLI tool's calls render in the Conversation and Timeline views, and keep its fixture coverage current.

**Size:** focused. **Protocol:** read [protocol.md](../protocol.md) sections Core, UI, Running the app, and Ship.
<!-- protocol: core ui app ship -->

## Launch

```text
Read docs/agents/tasks/tool-renderer.md and follow it. Focus: the SQL result renderer with wide, heterogeneous rows.
```

## Know first

- Read [adding tool renderers](../../design/adding-tool-renderers.md). It covers the component contract, payload and lifecycle rules, and the two kinds of expansion.
- The registry, `packages/ui/src/components/renderers/registry.ts`, is the source of truth for which renderer handles which tool.
- Results longer than 1024 bytes of UTF-8 arrive as a preview (except `web_search`). A renderer has to handle the preview and then the full payload.
- The fixture corpus in `scripts/fixtures/` feeds the native gallery and the browser harness. A registry coverage test fails when a renderer has no sample.

## Do

1. Pick a target:
   - a frequently used tool that falls back to plain text when a rich view would be much clearer; or
   - an existing renderer that mishandles a state: pending, empty, error, truncated preview, long lines, binary-ish content, the light theme, or 960×640.
2. Capture the current rendering: `node scripts/visual/capture.mjs --group=rich-tools --gallery --channel=msedge --out=.tracepilot/visual/rich-before`. Use `--case=rich-tool-<name>` to narrow it, then open the images.
3. Implement against the contract. The complete payload must stay reachable, input and output must stay distinct, and both pending and completed calls must render.
4. Add synthetic samples in `scripts/fixtures/`, with paired preview and full cases where expansion matters, plus renderer tests in `packages/ui/src/__tests__/`.
5. Capture "after" at the default viewport and at 960×640. Then check the native gallery:
   ```powershell
   pnpm app:start -Instance renderer-2 -Fixtures
   ```
   Use a fresh instance name each time your fixture changes. The generator refuses a data root built from an older corpus.

Don't change what a payload means, fetch full results outside the documented boundary, or restyle every renderer.

## Done when

The tool renders clearly in every state of its lifecycle, fixture coverage is current, and the before/after captures are in the PR.
