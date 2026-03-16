# Adding a New Tool Renderer

This guide walks you through adding a rich renderer for a new tool type in TracePilot. The architecture uses a **component-per-tool dispatcher pattern** — each tool gets its own Vue component(s), registered in a central registry, and automatically picked up by the dispatchers.

## Architecture Overview

```
ToolCallDetail.vue
├── ToolArgsRenderer.vue      ← dispatcher for arguments
│   ├── EditArgsRenderer.vue  ← rich renderer (if registered & enabled)
│   └── [JSON fallback]       ← default
└── ToolResultRenderer.vue    ← dispatcher for results
    ├── EditDiffRenderer.vue  ← rich renderer (if registered & enabled)
    └── PlainTextRenderer.vue ← default
```

Key files:

| File | Purpose |
|------|---------|
| `packages/ui/src/components/renderers/registry.ts` | Maps tool names → renderer components |
| `packages/ui/src/components/renderers/ToolResultRenderer.vue` | Dispatches result rendering |
| `packages/ui/src/components/renderers/ToolArgsRenderer.vue` | Dispatches argument rendering |
| `packages/ui/src/components/renderers/RendererShell.vue` | Shared wrapper (header, copy, truncation, error) |
| `packages/ui/src/components/renderers/CodeBlock.vue` | Shared code display with line numbers |
| `packages/ui/src/components/renderers/PlainTextRenderer.vue` | Fallback plain-text renderer |
| `packages/ui/src/utils/languageDetection.ts` | File-path → language detection |
| `packages/types/src/index.ts` | `RichRenderableToolName` type union |

## Step-by-Step Guide

### 1. Create Your Renderer Component

Create a new `.vue` file in `packages/ui/src/components/renderers/`.

**Naming convention:** `<ToolName><Type>Renderer.vue`
- Result renderer: `MyToolResultRenderer.vue` (or just `MyToolRenderer.vue`)
- Args renderer: `MyToolArgsRenderer.vue`

#### Result Renderer Template

```vue
<script setup lang="ts">
/**
 * MyToolRenderer — renders results from the "my_tool" tool call.
 *
 * [Describe what this tool does and how the renderer presents it.]
 */
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  /** The result content string (may be truncated). */
  content: string;
  /** The tool's arguments, parsed as a key-value map. */
  args: Record<string, unknown>;
  /** Whether the content was truncated. */
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  /** Emitted when the user clicks "Show Full Output". */
  "load-full": [];
}>();
</script>

<template>
  <RendererShell
    label="My Tool"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <!-- Your custom rendering here -->
    <div class="my-tool-output">
      {{ content }}
    </div>
  </RendererShell>
</template>

<style scoped>
.my-tool-output {
  padding: 10px 12px;
  font-size: 0.8125rem;
}
</style>
```

#### Args Renderer Template

```vue
<script setup lang="ts">
/**
 * MyToolArgsRenderer — renders arguments for the "my_tool" tool call.
 */

const props = defineProps<{
  /** Tool arguments as a key-value map. */
  args: Record<string, unknown>;
}>();
</script>

<template>
  <div class="my-tool-args">
    <!-- Render specific args with custom formatting -->
  </div>
</template>

<style scoped>
.my-tool-args {
  padding: 8px 12px;
  font-size: 0.8125rem;
}
</style>
```

### 2. Register in the Registry

Open `packages/ui/src/components/renderers/registry.ts` and add your entry to `RENDERER_REGISTRY`:

```ts
const RENDERER_REGISTRY: Record<string, RendererEntry> = {
  // ... existing entries ...
  my_tool: {
    label: "My Tool (Description)",
    resultComponent: defineAsyncComponent(() => import("./MyToolRenderer.vue")),
    // Optional: only add if you have a dedicated args renderer
    argsComponent: defineAsyncComponent(() => import("./MyToolArgsRenderer.vue")),
  },
};
```

**Important:**
- The key must match the tool name exactly as it appears in `TurnToolCall.toolName`
- The `label` appears in the Settings UI toggle grid
- Use `defineAsyncComponent` — renderers are lazy-loaded to avoid bundle bloat
- You can omit `argsComponent` or `resultComponent` if you don't need one

### 3. Add the Tool Name to the Type Union

Open `packages/types/src/index.ts` and add your tool name to `RichRenderableToolName`:

```ts
export type RichRenderableToolName =
  | "edit"
  | "view"
  // ... existing names ...
  | "my_tool";  // ← add here
```

This ensures the Settings UI shows a toggle for your tool and TypeScript catches typos.

### 4. Export (Optional)

If you want direct imports (not just via the registry), add your component to `packages/ui/src/components/renderers/index.ts`:

```ts
export { default as MyToolRenderer } from "./MyToolRenderer.vue";
```

### 5. Write Tests

Create `packages/ui/src/__tests__/MyToolRenderer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MyToolRenderer from "../components/renderers/MyToolRenderer.vue";

describe("MyToolRenderer", () => {
  it("renders content in custom format", () => {
    const wrapper = mount(MyToolRenderer, {
      props: {
        content: "some result text",
        args: { key: "value" },
      },
    });
    expect(wrapper.find(".my-tool-output").exists()).toBe(true);
    expect(wrapper.text()).toContain("some result text");
  });

  it("shows truncation notice", () => {
    const wrapper = mount(MyToolRenderer, {
      props: {
        content: "partial...",
        args: {},
        isTruncated: true,
      },
    });
    expect(wrapper.text()).toContain("Output was truncated");
  });
});
```

Run tests with:
```bash
pnpm --filter @tracepilot/ui test
```

### 6. Test the Settings Toggle

No additional work is needed — the Settings UI automatically picks up registered renderers via `getRegisteredRenderers()`. Your tool will appear in the "Tool Visualization" grid once registered.

## Shared Components

### RendererShell

All renderers should wrap their output in `<RendererShell>` for consistent styling:

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string?` | Header label (e.g., "Diff View") |
| `copyContent` | `string?` | Text to copy when the Copy button is clicked |
| `isTruncated` | `boolean?` | Shows "Output was truncated" banner with load button |
| `error` | `string?` | Shows an error state instead of the slot content |

| Event | Description |
|-------|-------------|
| `load-full` | Emitted when the user clicks "Show Full Output" |

### CodeBlock

Reusable syntax-highlighted code display:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `code` | `string` | (required) | The source code to display |
| `filePath` | `string?` | — | Used for language auto-detection |
| `language` | `string?` | — | Override language (skips detection) |
| `lineNumbers` | `boolean` | `true` | Show line numbers |
| `startLine` | `number` | `1` | Starting line number |
| `maxLines` | `number?` | — | Collapse after N lines (0 = unlimited) |
| `showLanguageBadge` | `boolean` | `true` | Show language badge in header |

### PlainTextRenderer

Simple fallback — wraps content in a scrollable `<pre>`:

| Prop | Type | Description |
|------|------|-------------|
| `content` | `string` | The text to display |

### Language Detection

```ts
import { detectLanguage, languageDisplayName } from "../utils/languageDetection";

const lang = detectLanguage("src/app.tsx"); // → "tsx"
const display = languageDisplayName("tsx");  // → "TypeScript JSX"
```

Supports 90+ file extensions. Add new ones in `packages/ui/src/utils/languageDetection.ts`.

## Props Contract

All result renderers receive these props from `ToolResultRenderer.vue`:

| Prop | Type | Always Present | Description |
|------|------|----------------|-------------|
| `content` | `string` | ✓ | The tool result (may be truncated to ~1KB) |
| `args` | `Record<string, unknown>` | ✓ | Parsed tool arguments |
| `tc` | `TurnToolCall` | ✓ | Full tool call object |
| `isTruncated` | `boolean` | ✗ | Whether `content` was truncated |

All args renderers receive:

| Prop | Type | Description |
|------|------|-------------|
| `args` | `Record<string, unknown>` | Parsed tool arguments |
| `tc` | `TurnToolCall` | Full tool call object |

## Data Considerations

- **`content` is always a string.** Even if the original result was JSON, it arrives as a stringified version. If you need structured data, use `JSON.parse()` with try/catch (see `SqlResultRenderer.vue` for an example).
- **Truncation:** Result content may be truncated to ~1KB. Always handle partial data gracefully. When `isTruncated` is true, emit `load-full` to let the user request the complete content.
- **No fabrication:** Do NOT invent data that isn't in the tool call. For example, the edit tool only provides `old_str` and `new_str` — don't generate surrounding context lines.

## Checklist

- [ ] Created renderer component(s) in `packages/ui/src/components/renderers/`
- [ ] Registered in `RENDERER_REGISTRY` in `registry.ts`
- [ ] Added tool name to `RichRenderableToolName` in `packages/types/src/index.ts`
- [ ] Used `RendererShell` wrapper for consistent chrome
- [ ] Used `defineAsyncComponent` for lazy loading
- [ ] Handled truncated content gracefully
- [ ] Written tests in `packages/ui/src/__tests__/`
- [ ] Verified Settings UI shows the toggle
- [ ] Run `pnpm --filter @tracepilot/ui test` — all green

## Existing Renderers (Reference)

| Tool | Result Renderer | Args Renderer | Notes |
|------|----------------|---------------|-------|
| `edit` | `EditDiffRenderer` | `EditArgsRenderer` | LCS word-level diff |
| `view` | `ViewCodeRenderer` | — | Code + directory detection |
| `create` | `CreateFileRenderer` | `CreateArgsRenderer` | New-file badge |
| `grep` | `GrepResultRenderer` | — | Grouped by file |
| `glob` | `GlobTreeRenderer` | — | File list with icons |
| `powershell` | `ShellOutputRenderer` | — | Terminal style |
| `read_powershell` | `ShellOutputRenderer` | — | Shared with powershell |
| `write_powershell` | `ShellOutputRenderer` | — | Shared with powershell |
| `sql` | `SqlResultRenderer` | — | JSON→table parsing |
| `web_search` | `WebSearchRenderer` | — | Source link extraction |
| `store_memory` | `StoreMemoryRenderer` | — | Memory card layout |
| `report_intent` | — | `ReportIntentRenderer` | Intent badge (args only) |
