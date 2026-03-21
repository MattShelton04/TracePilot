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
import { computed, type Component } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import { getRendererEntry } from "./registry";
import PlainTextRenderer from "./PlainTextRenderer.vue";
import RendererShell from "./RendererShell.vue";

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
  /** Full (un-truncated) arguments loaded from backend, if available. */
  fullArgs?: unknown;
}>();

const emit = defineEmits<{
  'load-full': [toolCallId: string];
}>();

const entry = computed(() => getRendererEntry(props.tc.toolName));

const activeComponent = computed<Component | null>(() => {
  if (!props.richEnabled) return null;
  return entry.value?.resultComponent ?? null;
});

const parsedArgs = computed(() => {
  const args = props.fullArgs ?? props.tc.arguments;
  if (!args || typeof args !== "object") return {};
  return args as Record<string, unknown>;
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
  <!-- Fallback: plain text in a shell -->
  <RendererShell
    v-else-if="content"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full', tc.toolCallId ?? '')"
  >
    <PlainTextRenderer :content="content" />
  </RendererShell>
</template>
