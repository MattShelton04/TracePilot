<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs } from "@tracepilot/types";
import { computed } from "vue";
import { toolCallStatus, toolResultPreview } from "../../utils/toolCallStatus";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import PlainTextRenderer from "./PlainTextRenderer.vue";
import { getRendererEntry } from "./registry";

const props = defineProps<{
  tc: TurnToolCall;
  content: string;
  richEnabled: boolean;
  isTruncated?: boolean;
  loading?: boolean;
  failed?: boolean;
  streaming?: boolean;
}>();
const emit = defineEmits<{
  "load-full": [toolCallId: string];
  "retry-full": [toolCallId: string];
}>();
const activeComponent = computed(() =>
  props.richEnabled ? getRendererEntry(props.tc.toolName)?.resultComponent : null,
);
const parsedArgs = computed(() => getToolArgs(props.tc));
const preview = computed(() => toolResultPreview(props.content, props.isTruncated));
const status = computed(() => toolCallStatus(props.tc));
const useMarkdown = computed(
  () =>
    props.richEnabled &&
    (props.tc.toolName === "task" || props.tc.isSubagent || props.tc.toolName === "web_fetch"),
);
</script>

<template>
  <div class="tool-rendered-result" :aria-busy="loading || undefined">
    <!-- The dispatcher owns transport truncation. Renderers also work standalone. -->
    <component
      v-if="activeComponent"
      :is="activeComponent"
      :key="tc.toolCallId ?? tc.toolName"
      :content="preview"
      :args="parsedArgs"
      :tc="tc"
      :is-truncated="false"
      :streaming="streaming"
    />
    <RendererShell
      v-else-if="useMarkdown && preview"
      :key="'markdown-' + (tc.toolCallId ?? tc.toolName)"
      :tool-name="tc.isSubagent ? 'Agent response' : tc.toolName === 'web_fetch' ? 'Web page' : 'Task response'"
      :status="status"
      :copy-text="preview"
    >
      <RendererScrollRegion label="response">
        <MarkdownContent :content="preview" :render="true" class="tool-markdown-result" />
      </RendererScrollRegion>
    </RendererShell>
    <PlainTextRenderer
      v-else
      :key="'plain-' + (tc.toolCallId ?? tc.toolName)"
      :content="preview"
      :tc="tc"
      :is-truncated="false"
    />
    <RendererTruncationFooter
      v-if="isTruncated"
      :loading="loading"
      :failed="failed"
      @load-full="emit('load-full', tc.toolCallId ?? '')"
      @retry="emit('retry-full', tc.toolCallId ?? '')"
    />
  </div>
</template>

<style scoped>
.tool-rendered-result { min-width: 0; max-width: 100%; }
.tool-markdown-result { padding: 12px; overflow-wrap: anywhere; font-size: 13px; }
</style>
