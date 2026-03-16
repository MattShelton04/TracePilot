<script setup lang="ts">
/**
 * ReportIntentRenderer — renders report_intent as an intent badge.
 * This is an args renderer (report_intent usually has no result content).
 */
defineProps<{
  args: Record<string, unknown>;
}>();
</script>

<template>
  <div v-if="typeof args.intent === 'string'" class="intent-renderer">
    <span class="intent-icon">🎯</span>
    <span class="intent-text">{{ args.intent }}</span>
  </div>
</template>

<style scoped>
.intent-renderer {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  background: var(--accent-muted, rgba(99, 102, 241, 0.1));
  border: 1px solid var(--accent-emphasis, #6366f1);
}
.intent-icon {
  font-size: 0.8125rem;
}
.intent-text {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent-fg, #818cf8);
}
</style>
