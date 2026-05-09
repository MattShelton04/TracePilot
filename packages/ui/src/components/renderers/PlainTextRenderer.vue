<script setup lang="ts">
/**
 * PlainTextRenderer — fallback renderer for unknown or disabled tool types.
 */
import { FileText } from "lucide-vue-next";
import RendererShell from "../RendererShell.vue";

defineProps<{
  content: string;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();
</script>

<template>
  <RendererShell tool-name="Output" status="success" :copy-text="content">
    <template #icon><FileText :size="16" /></template>
    <pre class="plain-text-renderer">{{ content }}</pre>
    <button v-if="isTruncated" type="button" class="rs-trunc" @click="emit('load-full')">
      Output truncated — Show full
    </button>
  </RendererShell>
</template>

<style scoped>
.plain-text-renderer {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px 12px;
  margin: 0;
  max-height: 400px;
  overflow: auto;
  color: var(--text-secondary);
}
.rs-trunc {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--canvas-inset);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.rs-trunc:hover { color: var(--text-primary); background: var(--surface-tertiary); }
</style>
