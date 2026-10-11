# Adding and maintaining tool renderers

Tool renderers present recorded inputs and outputs without changing their meaning.
A rich view must retain the complete available payload, distinguish input from
returned results, and support both pending and completed calls.

## Architecture

Conversation details and timeline detail panels share the same rendering path:

```text
ToolCallDetail / ToolDetailPanel
├── useToolDisplayResult       persisted/full result, live partials, empty completion
├── ToolArgsRenderer           Parameters disclosure + rich input or complete raw input
└── ToolResultRenderer         rich/plain/Markdown dispatch + one full-output action
    ├── registered renderer    RendererShell + payload presentation
    └── fallback               PlainTextRenderer or sanitized MarkdownContent
```

The source of truth is
[`registry.ts`](../../packages/ui/src/components/renderers/registry.ts).
Components live in `packages/ui/src/components/renderers/`; the shared shell,
scroll region and truncation footer live **one directory above**, in
`packages/ui/src/components/`.

## Component contract

`ToolResultRenderer` passes `content: string`, `args: Record<string, unknown>`
and `tc: TurnToolCall` to a registered result component. `content` may be an
incomplete preview. The dispatcher removes only the recognized trailing transport
marker before presentation. Parse conservatively and fall back to the supplied
text when its format is unknown.

Use [`RendererShell.vue`](../../packages/ui/src/components/RendererShell.vue)
for result framing:

| Prop | Purpose |
| --- | --- |
| `toolName: string` | Required readable title |
| `status: RendererShellStatus` | Required pending/success/warning/error/cancelled state |
| `copyText?: string` | Available payload copied by the header action |
| `primaryHint?: string` | Optional short context; do not repeat the whole body |
| `iconName?: string` | Registered Lucide icon, or supply the `icon` slot |
| `durationMs?`, `tokenUsage?` | Optional footer metadata |
| `collapsible?`, `defaultCollapsed?` | Optional shell disclosure |

Slots are `default`, `icon`, `tabs` and `footer`; shell events are `toggle`
and `retry`. The shell does **not** fetch full results or accept
`label`, `copyContent`, `isTruncated` or `error` props.

The body is flush. Each payload section owns its padding, normally 12px.
Use 13px body text and readable 12px secondary text, existing design tokens and
visible keyboard focus. Allow names, descriptions and metadata to wrap. Code
and tables may scroll horizontally inside their own region, never the page.
Copy should retain the available source rather than only the visible page.

A minimal result component:

```vue
<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
}>();
const status = computed(() => toolCallStatus(props.tc));
</script>

<template>
  <RendererShell tool-name="My tool" :status="status" :copy-text="content">
    <RendererScrollRegion label="output">
      <pre class="my-tool-output">{{ content || (status === 'pending' ? 'Waiting for output…' : 'No output returned.') }}</pre>
    </RendererScrollRegion>
  </RendererShell>
</template>

<style scoped>
.my-tool-output {
  margin: 0;
  padding: 12px;
  font: 13px/1.6 var(--font-mono, monospace);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
```

An argument component receives `args` and `tc`. Present proposed operations
as input, and preserve long input through scrolling, paging or expansion.

## Payload and lifecycle rules

- Use [`toolCallStatus(tc)`](../../packages/ui/src/utils/toolCallStatus.ts).
  Explicit failure or `tc.error` wins; incomplete calls are pending; successful
  or completed calls are successful. An omitted `tc` supports standalone legacy
  rendering with success. Do not infer process exit code from successful tool
  invocation, worker completion from successful `read_agent`, or delivery from
  the presence of recipient arguments.
- Keep acknowledgments, diagnostics and failures visible separately from submitted
  code, patches, memory or messages. A successful parse must not discard unknown
  fields or surrounding text. Use a faithful fallback or
  [`RecordedToolResponse.vue`](../../packages/ui/src/components/renderers/RecordedToolResponse.vue)
  for a clearly labelled Raw response disclosure.
- Preserve exact values: empty strings, null, false, zero, heterogeneous table
  columns and nested objects differ. Never fabricate source context, absolute
  line numbers, output or successful delivery.
- [`useToolDisplayResult`](../../packages/ui/src/composables/useToolDisplayResult.ts)
  shares live/final selection between both detail hosts. Full results replace
  previews; a persisted empty string replaces stale live text. PowerShell uses
  the same renderer while streaming and after completion. Preserve local
  expansion when output appends and reset state when the call identity changes.
- Render Markdown with the existing sanitized `MarkdownContent` pipeline.
  Avoid handwritten HTML/Markdown replacements and unrequested external assets.

## Parameters and the two kinds of expansion

**Parameters are always recoverable.** `ToolArgsRenderer` keeps the Parameters
disclosure whenever input exists. Rich pending input also includes an
All parameters disclosure. The legacy registry flag `hideArgsWithRichResult`
now selects complete raw parameters when a rich result already presents the
input; it does not remove input access. `autoExpandArgs` makes relevant pending
input discoverable. User disclosure choices are retained through completion.

**Backend full-output loading belongs only to `ToolResultRenderer`.** It
receives `isTruncated`, `loading` and `failed`, renders one
`RendererTruncationFooter`, and emits `load-full(toolCallId)` or
`retry-full(toolCallId)`. Both detail hosts forward those events and states.
The button disables during loading, offers an explicit retry after failure,
and disappears when the full payload arrives.

The dispatcher passes `isTruncated=false` to leaves to suppress duplicate fetch
buttons. Existing leaves may keep their optional `isTruncated`/`load-full`
API for standalone callers, but normal dispatched rendering must not add another
transport footer.

**Local expansion changes presentation only.**
[`RendererScrollRegion.vue`](../../packages/ui/src/components/RendererScrollRegion.vue)
measures actual overflow, provides a keyboard-accessible scroll region, and adds
reversible Show all / Show less controls. Its default `maxHeight` is 320px;
supply a meaningful `label`. It never fetches missing backend output.
Avoid multiple controls that expand the same content.

For source, use [`CodeBlock.vue`](../../packages/ui/src/components/renderers/CodeBlock.vue).
`maxLines` selects nonoverlapping pages, with paging controls outside the scroll
area. `startLine` controls the source offset; leave fragment numbering explicit.
Very long lines use bounded character chunks with previous/next navigation and
Copy full line, preserving text beyond the rendering limit. Language detection,
line numbers, search highlighting and fill-height behavior are shared here;
do not duplicate them in individual renderers.

## Registering a tool

1. Add the component and lazy `defineAsyncComponent` entry to `registry.ts`.
   The key must match `TurnToolCall.toolName`; `label` appears in settings.
   Add `argsComponent` only when a dedicated input view adds value.
2. Add the tool to `RichRenderableToolName` in
   [`packages/types/src/tool-rendering.ts`](../../packages/types/src/tool-rendering.ts).
   Export from `renderers/index.ts` only when direct consumers need it.
3. Add meaningful parser/component tests and shared sanitized samples in
   [`scripts/fixtures/rich-tools.mjs`](../../scripts/fixtures/rich-tools.mjs).
   Registry coverage must include both result and argument renderers.
4. Validate rich and plain modes, full input access, empty/failure/pending states,
   long/unknown payloads, and initial versus expanded/fetched results. Exercise
   loading/retry and live-to-final transitions through the shared detail hosts.
   See [testing](../testing.md) and [visual regression](../visual-regression.md).

Inspect actual screenshots at 1440×960, 960×640 and 2560×1440. Synthetic captures
exercise the frontend; verify live behavior in the native app using
[app automation](../app-automation.md). Keep one-off captures and audit notes in
ignored agent/output directories.

## Current registry

There are 20 registered tool names and six argument-renderer registrations.

| Tool | Result component | Argument component |
| --- | --- | --- |
| `edit` | EditDiffRenderer | EditArgsRenderer |
| `view` | ViewCodeRenderer | — |
| `create` | CreateFileRenderer | CreateArgsRenderer |
| `grep`, `rg` | GrepResultRenderer | — |
| `glob` | GlobTreeRenderer | — |
| `shell`, `powershell`, `read_powershell`, `write_powershell`, `stop_powershell` | ShellOutputRenderer | — |
| `sql` | SqlResultRenderer | — |
| `web_search` | WebSearchRenderer | — |
| `store_memory` | StoreMemoryRenderer | — |
| `report_intent` | ReportIntentRenderer | ReportIntentRenderer |
| `ask_user` | AskUserRenderer | AskUserArgsRenderer |
| `read_agent` | ReadAgentRenderer | — |
| `write_agent` | WriteAgentRenderer | WriteAgentArgsRenderer |
| `list_agents` | ListAgentsRenderer | — |
| `apply_patch` | ApplyPatchRenderer | ApplyPatchArgsRenderer |

`report_intent` reuses one component for its pending intent and returned
acknowledgment. `task`, calls marked `isSubagent` (including named task aliases)
and `web_fetch` use the dispatcher's Markdown fallback when rich rendering is
enabled. Other unregistered or disabled tools use `PlainTextRenderer`.

Registry keys are canonical tool names. A source whose tools have other names
(Claude Code's `Bash`, for example) maps each call to a canonical `toolName`
and keeps the original in `TurnToolCall.nativeToolName`. The canonical name
picks the renderer, icon and category; headers show the native name. See
`packages/ui/src/__tests__/nativeToolNames.test.ts`.

`shell` and `stop_powershell` are registered but not yet listed in
`RichRenderableToolName`.
