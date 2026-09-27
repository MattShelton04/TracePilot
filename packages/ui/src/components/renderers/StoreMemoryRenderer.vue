<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { Brain } from "lucide-vue-next";
import { computed } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import { formatAskUserValue } from "./askUserSchema";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();
const emit = defineEmits<{ "load-full": [] }>();
const status = computed(() => toolCallStatus(props.tc));
const fact = computed(() => (typeof props.args.fact === "string" ? props.args.fact : null));
const metadata = computed(() =>
  [
    ["Subject", props.args.subject],
    ["Reason", props.args.reason],
    ["Citations", props.args.citations],
  ]
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({
      label: String(label),
      value: formatAskUserValue(value),
    })),
);
const copyText = computed(() =>
  [
    fact.value,
    ...metadata.value.map(({ label, value }) => `${label}: ${value}`),
    props.content && `Response: ${props.content}`,
  ]
    .filter(Boolean)
    .join("\n\n"),
);
</script>

<template>
  <RendererShell tool-name="Store memory" :status="status" :copy-text="copyText">
    <template #icon><Brain :size="16" /></template>
    <RendererScrollRegion label="memory details"><div class="memory-card">
      <div v-if="fact != null" class="memory-fact">{{ fact || 'Empty memory' }}</div>
      <dl v-if="metadata.length" class="memory-metadata">
        <div v-for="item in metadata" :key="item.label" class="memory-meta">
          <dt class="memory-meta-label">{{ item.label }}</dt>
          <dd :class="['memory-meta-value', { 'memory-citations-text': item.label === 'Citations' }]">{{ item.value }}</dd>
        </div>
      </dl>
      <div class="memory-response" :class="{ 'memory-response--error': status === 'error' }">
        <span class="memory-meta-label">Response</span>
        <pre v-if="content">{{ content }}</pre>
        <span v-else class="memory-empty">{{ status === 'pending' ? 'Waiting for storage confirmation…' : 'No response returned.' }}</span>
      </div>
    </div></RendererScrollRegion>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.memory-card { display: flex; flex-direction: column; gap: 12px; padding: 12px; min-width: 0; overflow-wrap: anywhere; }
.memory-fact { font-size: 13px; color: var(--text-primary); line-height: 1.6; white-space: pre-wrap; }
.memory-metadata { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.memory-meta { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: baseline; gap: 12px; }
.memory-meta-label { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
.memory-meta-value { margin: 0; min-width: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap; }
.memory-citations-text { font-family: var(--font-mono, monospace); font-size: 12px; }
.memory-response { display: flex; flex-direction: column; gap: 4px; padding-top: 10px; border-top: 1px solid var(--border-muted); }
.memory-response pre { margin: 0; font: 13px/1.6 var(--font-sans, sans-serif); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); }
.memory-response--error pre { color: var(--danger-fg); }
.memory-empty { font-size: 13px; color: var(--text-tertiary); }
</style>
