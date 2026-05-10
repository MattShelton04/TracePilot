<script setup lang="ts">
/**
 * StoreMemoryRenderer — renders store_memory tool results as a memory card.
 */

import { Brain } from "lucide-vue-next";
import { computed } from "vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const fact = computed(() => (typeof props.args?.fact === "string" ? props.args.fact : null));
const subject = computed(() =>
  typeof props.args?.subject === "string" ? props.args.subject : null,
);
const reason = computed(() => (typeof props.args?.reason === "string" ? props.args.reason : null));
const citations = computed(() =>
  typeof props.args?.citations === "string" ? props.args.citations : null,
);
</script>

<template>
  <RendererShell
    tool-name="Store Memory"
    status="success"
    :primary-hint="subject ?? undefined"
    :copy-text="fact ?? content"
  >
    <template #icon><Brain :size="16" /></template>
    <div class="memory-card">
      <div v-if="fact" class="memory-fact">
        <span>{{ fact }}</span>
      </div>
      <div v-if="subject" class="memory-meta">
        <span class="memory-meta-label">Subject</span>
        <span class="memory-meta-badge">{{ subject }}</span>
      </div>
      <div v-if="reason" class="memory-reason">
        <span class="memory-meta-label">Reason</span>
        <p class="memory-reason-text">{{ reason }}</p>
      </div>
      <div v-if="citations" class="memory-citations">
        <span class="memory-meta-label">Citations</span>
        <code class="memory-citations-text">{{ citations }}</code>
      </div>
      <pre v-if="!fact" class="memory-fallback">{{ content }}</pre>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.memory-card {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.memory-fact {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-weight: 500;
  line-height: 1.5;
}
.memory-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.memory-meta-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.memory-meta-badge {
  font-size: 0.6875rem;
  padding: 1px 8px;
  border-radius: 9999px;
  background: var(--accent-muted);
  color: var(--accent-fg);
}
.memory-reason {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.memory-reason-text {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
}
.memory-citations {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.memory-citations-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  word-break: break-all;
  line-height: 1.5;
}
.memory-fallback {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}
</style>
