<template>
  <div class="stats-panel" :class="{ visible }">
    <div class="stats-row">
      <div class="stat-item">
        <span class="stat-item-label">Sessions:</span>
        <span class="stat-item-value">{{ displaySessions }}/{{ totalSessions }}</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-item-label">Tokens:</span>
        <span class="stat-item-value">{{ displayTokens }}</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-item-label">Events:</span>
        <span class="stat-item-value">{{ displayEvents }}</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-item-label">Repos:</span>
        <span class="stat-item-value">{{ displayRepos }}</span>
      </div>
    </div>
    <div class="stats-mini-bar">
      <div class="stats-mini-fill" :style="{ width: progressPct + '%' }" />
    </div>
    <div class="repo-legend">
      <div
        v-for="item in repoLegendItems"
        :key="item.name"
        class="repo-legend-item visible"
        :title="item.name"
      >
        <span class="legend-dot" :style="{ background: item.color }" />
        {{ item.displayName }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RepoLegendItem } from '@/composables/useOrbitalAnimation'

defineProps<{
  visible: boolean
  displaySessions: string
  totalSessions: number
  displayTokens: string
  displayEvents: string
  displayRepos: string
  progressPct: number
  repoLegendItems: RepoLegendItem[]
}>()
</script>

<style scoped>
.stats-panel {
  position: fixed;
  bottom: calc(72px * var(--ui-scale, 1));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(8px * var(--ui-scale, 1));
  padding: calc(12px * var(--ui-scale, 1)) calc(24px * var(--ui-scale, 1));
  background: rgba(22, 27, 34, 0.7);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid #21262d;
  border-radius: 10px;
  font-size: calc(0.75rem * var(--ui-scale, 1));
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.stats-panel.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.stats-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stats-row .stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stats-row .stat-item-label {
  font-size: 0.6875rem;
  color: #7d8590;
}

.stats-row .stat-item-value {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: #e6edf3;
  font-variant-numeric: tabular-nums;
}

.stats-row .stat-divider {
  width: 1px;
  height: 16px;
  background: #21262d;
}

.stats-mini-bar {
  width: 100%;
  height: 3px;
  background: #21262d;
  border-radius: 2px;
  overflow: hidden;
}

.stats-mini-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  width: 0%;
}

.repo-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.repo-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #7d8590;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.repo-legend-item.visible {
  opacity: 1;
  transform: translateY(0);
}

.repo-legend-item .legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
