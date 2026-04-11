<script setup lang="ts">
/**
 * ToolResultRenderer — dispatcher component for tool call results.
 *
 * Selects the appropriate rich renderer based on `toolName` and the
 * user's rendering preferences (provided via the `richEnabled` prop).
 * Falls back to PlainTextRenderer when:
 *  - rich rendering is disabled for this tool
 *  - no renderer is registered for this tool
 *  - content is empty/null
 */

import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs } from "@tracepilot/types";
import { type Component, computed } from "vue";
import MarkdownContent from "../MarkdownContent.vue";
import PlainTextRenderer from "./PlainTextRenderer.vue";
import RendererShell from "./RendererShell.vue";
import { getRendererEntry } from "./registry";

const props = defineProps<{
  tc: TurnToolCall;
  /** The result content (may be full or truncated preview). */
  content: string;
  /** Whether rich rendering is enabled for this tool. */
  richEnabled: boolean;
  /** Whether the content is truncated. */
  isTruncated?: boolean;
  /** Whether a full-content load is in progress. */
  loading?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [toolCallId: string];
}>();

const entry = computed(() => getRendererEntry(props.tc.toolName));

const activeComponent = computed<Component | null>(() => {
  if (!props.richEnabled) return null;
  return entry.value?.resultComponent ?? null;
});

const parsedArgs = computed(() => {
  return getToolArgs(props.tc);
});
</script>

<template>
  <!-- Rich renderer available and enabled -->
  <component
    v-if="activeComponent"
    :is="activeComponent"
    :content="content"
    :args="parsedArgs"
    :tc="tc"
    :is-truncated="isTruncated"
    @load-full="emit('load-full', tc.toolCallId ?? '')"
  />
  <!-- Fallback: plain text or markdown in a shell -->
  <RendererShell
    v-else-if="content"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full', tc.toolCallId ?? '')"
  >
    <MarkdownContent
      v-if="richEnabled && ['read_agent', 'task'].includes(tc.toolName)"
      :content="content"
      :render="true"
      style="padding: 10px 12px; background: var(--canvas-default);"
    />
    <PlainTextRenderer v-else :content="content" />
  </RendererShell>
</template>
