<script setup lang="ts">
import { useLiveClock } from "@/composables/useLiveClock";

const { liveTime } = useLiveClock();
</script>

<template>
  <div class="page-title-bar">
    <h1 class="page-title">
      <svg class="title-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
        <path d="M6.906.664a1.749 1.749 0 0 1 2.187 0l5.25 4.2c.415.332.657.835.657 1.367v7.019A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1-.75-.75V9H7v5.25a.75.75 0 0 1-.75.75h-3.5A1.75 1.75 0 0 1 1 13.25V6.23c0-.531.242-1.034.657-1.366l5.25-4.2Z" />
      </svg>
      Command Centre
    </h1>
    <div class="live-indicator">
      <span class="live-dot" />
      <span class="live-text">Live — {{ liveTime }}</span>
    </div>
  </div>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.page-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.title-icon {
  flex-shrink: 0;
  color: var(--accent-fg);
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
