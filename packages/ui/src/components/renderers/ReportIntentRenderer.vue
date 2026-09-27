<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { Target } from "lucide-vue-next";
import { computed } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  args: Record<string, unknown>;
  content?: string;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();
const emit = defineEmits<{ "load-full": [] }>();
const status = computed(() => toolCallStatus(props.tc));
const intent = computed(() => (typeof props.args.intent === "string" ? props.args.intent : null));
const copyText = computed(() => [intent.value, props.content].filter(Boolean).join("\n\n"));
</script>

<template>
  <RendererShell tool-name="Report intent" :status="status" :copy-text="copyText">
    <template #icon><Target :size="16" /></template>
    <RendererScrollRegion label="intent details">
    <div v-if="intent != null" class="intent-renderer">
      <span class="intent-text">{{ intent || 'Empty intent' }}</span>
    </div>
    <p v-if="content" class="intent-response" :class="{ 'intent-response--error': status === 'error' }">{{ content }}</p>
    <p v-else-if="status === 'pending'" class="intent-response">Recording intent…</p>
    <p v-else-if="intent == null" class="intent-response">No intent supplied.</p>
    </RendererScrollRegion>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.intent-renderer { padding: 12px; }
.intent-text { font-size: 13px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; overflow-wrap: anywhere; }
.intent-response { margin: 0; padding: 0 12px 12px; color: var(--text-secondary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.intent-response:first-child { padding-top: 12px; }
.intent-response--error { color: var(--danger-fg); }
</style>
