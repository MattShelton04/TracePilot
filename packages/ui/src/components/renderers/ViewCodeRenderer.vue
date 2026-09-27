<script setup lang="ts">
/**
 * ViewCodeRenderer — renders view tool results with line numbers and language detection.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { FileCode2 } from "lucide-vue-next";
import { computed } from "vue";
import { detectLanguage, languageDisplayName } from "../../utils/languageDetection";
import { toolCallStatus } from "../../utils/toolCallStatus";
import {
  isDirectoryOutput,
  normalizeViewedSource,
  sourceLineCount,
} from "../../utils/toolFileContent";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import CodeBlock from "./CodeBlock.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
  tc?: TurnToolCall;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const filePath = computed(() =>
  typeof props.args?.path === "string" ? props.args.path : undefined,
);

const viewRange = computed<[number, number] | null>(() => {
  const r = props.args?.view_range;
  if (
    Array.isArray(r) &&
    r.length === 2 &&
    Number.isInteger(r[0]) &&
    Number(r[0]) > 0 &&
    Number.isInteger(r[1]) &&
    (r[1] === -1 || Number(r[1]) >= Number(r[0]))
  ) {
    return [Number(r[0]), Number(r[1])];
  }
  return null;
});

const source = computed(() => normalizeViewedSource(props.content, viewRange.value?.[0] ?? 1));
const isDirectoryListing = computed(() => isDirectoryOutput(props.content));
const lineCount = computed(() => sourceLineCount(source.value.code));
const language = computed(() => detectLanguage(filePath.value ?? ""));
const status = computed(() => toolCallStatus(props.tc));
</script>

<template>
  <RendererShell
    tool-name="View"
    :status="status"
    :primary-hint="filePath"
    :copy-text="content"
  >
    <template #icon><FileCode2 :size="16" /></template>
    <div v-if="!isDirectoryListing" class="view-code-info">
      <span class="view-code-badge">{{ lineCount }} line{{ lineCount !== 1 ? 's' : '' }}</span>
      <span class="view-code-badge">{{ languageDisplayName(language) }}</span>
      <span v-if="viewRange" class="view-code-range">
        Lines {{ viewRange[0] }}–{{ viewRange[1] === -1 ? 'end' : viewRange[1] }}
      </span>
    </div>
    <RendererScrollRegion v-if="isDirectoryListing" label="directory listing"><pre class="view-code-dir">{{ content }}</pre></RendererScrollRegion>
    <CodeBlock
      v-else
      :code="source.code"
      :language="language"
      :start-line="source.startLine"
      :max-lines="2000"
      :show-language-badge="false"
    />
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.view-code-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.view-code-badge {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.view-code-range {
  font-size: 0.6875rem;
  color: var(--accent-fg);
  font-family: 'JetBrains Mono', monospace;
}
.view-code-dir {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  padding: 10px 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}
</style>
