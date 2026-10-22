<script setup lang="ts">
/**
 * PlainTextRenderer — fallback renderer for unknown or disabled tool types.
 * A complete JSON object or array is shown re-indented with JSON highlighting.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { FileText } from "lucide-vue-next";
import { computed } from "vue";
import { useToolCallStatus } from "../../composables/sessionEnded";
import { formatJsonResult } from "../../utils/jsonResult";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import CodeBlock from "./CodeBlock.vue";

const props = defineProps<{
  content: string;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();
const status = useToolCallStatus(() => props.tc);
const json = computed(() => formatJsonResult(props.content));

const emit = defineEmits<{
  "load-full": [];
}>();
</script>

<template>
  <RendererShell tool-name="Output" :status="status" :copy-text="content">
    <template #icon><FileText :size="16" /></template>
    <CodeBlock
      v-if="json"
      class="plain-text-json"
      :code="json"
      language="json"
      :line-numbers="false"
      :max-lines="2000"
      :show-language-badge="false"
    />
    <RendererScrollRegion v-else label="output">
      <pre class="plain-text-renderer">{{ content || (status === 'pending' ? 'Waiting for output…' : 'No output returned.') }}</pre>
    </RendererScrollRegion>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.plain-text-renderer {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px 12px;
  margin: 0;
  color: var(--text-secondary);
}
.plain-text-json :deep(.code-block-content) {
  padding-block: 8px;
}
</style>
