<script setup lang="ts">
/**
 * CreateFileRenderer — renders the create tool result showing the created file.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { FilePlus } from "lucide-vue-next";
import { computed } from "vue";
import { detectLanguage, languageDisplayName } from "../../utils/languageDetection";
import { toolCallStatus } from "../../utils/toolCallStatus";
import { sourceLineCount } from "../../utils/toolFileContent";
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

const fileContent = computed(() =>
  typeof props.args?.file_text === "string" ? props.args.file_text : null,
);
const lineCount = computed(() => sourceLineCount(fileContent.value ?? ""));
const status = computed(() => toolCallStatus(props.tc));
const language = computed(() => detectLanguage(filePath.value ?? ""));
</script>

<template>
  <RendererShell
    tool-name="Create File"
    :status="status"
    :primary-hint="filePath"
    :copy-text="fileContent ?? content"
  >
    <template #icon><FilePlus :size="16" /></template>
    <div v-if="fileContent !== null" class="create-file-info">
      <span class="create-file-badge" :class="{ 'create-file-badge--new': status === 'success' }">{{ status === 'success' ? 'New File' : 'Proposed file' }}</span>
      <span class="create-file-badge">{{ lineCount }} line{{ lineCount !== 1 ? 's' : '' }}</span>
      <span class="create-file-badge">{{ languageDisplayName(language) }}</span>
    </div>
    <CodeBlock
      v-if="fileContent !== null"
      :code="fileContent"
      :language="language"
      :max-lines="2000"
      :show-language-badge="false"
    />
    <div v-if="content" class="create-file-response"><span>Result</span><pre>{{ content }}</pre></div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.create-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.create-file-response { padding: 12px; border-top: 1px solid var(--border-muted); }
.create-file-response span { color: var(--text-tertiary); font-size: 12px; }
.create-file-response pre { margin: 4px 0 0; font: inherit; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); max-height: 240px; overflow: auto; }
.create-file-badge {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.create-file-badge--new {
  color: var(--success-fg);
  font-weight: 600;
}
</style>
