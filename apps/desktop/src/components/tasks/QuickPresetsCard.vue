<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

defineProps<{
  presets: TaskPreset[];
}>();

const router = useRouter();
</script>

<template>
  <div class="quick-presets-card">
    <div class="quick-presets-header">
      <span class="quick-presets-title">Quick Presets</span>
      <button class="quick-presets-link" @click="pushRoute(router, ROUTE_NAMES.taskPresets)">
        Manage →
      </button>
    </div>
    <div v-if="presets.length === 0" class="quick-presets-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4; margin-bottom: 6px">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M12 8v8M8 12h8" />
      </svg>
      <span>No enabled presets</span>
    </div>
    <div v-else class="quick-preset-grid">
      <button
        v-for="preset in presets.slice(0, 6)"
        :key="preset.id"
        class="quick-preset-card"
        @click="pushRoute(router, ROUTE_NAMES.taskCreate, { query: { presetId: preset.id } })"
      >
        <div class="quick-preset-icon">
          <svg v-if="preset.taskType === 'session_summary'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
          </svg>
          <svg v-else-if="preset.taskType === 'daily_digest' || preset.taskType === 'weekly_digest'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <div class="quick-preset-info">
          <span class="quick-preset-name">{{ preset.name }}</span>
          <span v-if="preset.builtin" class="quick-preset-builtin">Built-in</span>
        </div>
        <span class="quick-preset-arrow">→</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.quick-presets-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  min-width: 0;
  overflow: hidden;
}

.quick-presets-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.quick-presets-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.quick-presets-link {
  background: none;
  border: none;
  color: var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  transition: opacity var(--transition-fast);
}

.quick-presets-link:hover {
  opacity: 0.8;
}

.quick-presets-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 0.8125rem;
  color: var(--text-placeholder);
  text-align: center;
  padding: 24px 0;
}

.quick-preset-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-preset-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
  text-align: left;
  color: inherit;
  font: inherit;
}

.quick-preset-card:hover {
  border-color: var(--accent-fg);
  background: var(--accent-muted);
}

.quick-preset-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  color: var(--accent-fg);
  flex-shrink: 0;
}

.quick-preset-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.quick-preset-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-preset-builtin {
  font-size: 0.5625rem;
  padding: 1px 5px;
  border-radius: var(--radius-sm, 4px);
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.quick-preset-arrow {
  color: var(--text-tertiary);
  font-size: 0.875rem;
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.quick-preset-card:hover .quick-preset-arrow {
  transform: translateX(2px);
  color: var(--accent-fg);
}
</style>
