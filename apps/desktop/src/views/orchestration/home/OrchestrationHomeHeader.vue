<script setup lang="ts">
import { PageHeader } from "@tracepilot/ui";
import { useLiveClock } from "@/composables/useLiveClock";

const { liveTime } = useLiveClock();
</script>

<template>
  <PageHeader
    title="Command Centre"
    icon-name="layout-dashboard"
    size="sm"
    class="orchestration-home-header"
  >
    <template #actions>
      <div class="live-indicator">
        <span class="live-dot" />
        <span class="live-text">Live — {{ liveTime }}</span>
      </div>
    </template>
  </PageHeader>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.orchestration-home-header {
  margin-bottom: 24px;
  padding-left: 0;
  padding-right: 0;
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-fg);
  animation: pulse 2s ease-in-out infinite;
}

.live-text {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
