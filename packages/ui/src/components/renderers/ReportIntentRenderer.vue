<script setup lang="ts">
/**
 * ReportIntentRenderer — renders report_intent as an intent badge.
 */
import { Target } from "lucide-vue-next";
import RendererShell from "../RendererShell.vue";

defineProps<{
  args: Record<string, unknown>;
}>();
</script>

<template>
  <RendererShell tool-name="Report Intent" status="success">
    <template #icon><Target :size="16" /></template>
    <div v-if="typeof args.intent === 'string'" class="intent-renderer">
      <span class="intent-text">{{ args.intent }}</span>
    </div>
  </RendererShell>
</template>

<style scoped>
.intent-renderer {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
}
.intent-text {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent-fg);
}
</style>
