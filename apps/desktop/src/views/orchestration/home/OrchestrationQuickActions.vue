<script setup lang="ts">
import { useRouter } from "vue-router";
import { ROUTE_NAMES, type RouteName } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

const router = useRouter();

interface QuickAction {
  emoji: string;
  title: string;
  desc: string;
  to: RouteName | null;
  disabled: boolean;
}

const quickActions: QuickAction[] = [
  {
    emoji: "🚀",
    title: "Launch Session",
    desc: "Start a new Copilot CLI session",
    to: ROUTE_NAMES.sessionLauncher,
    disabled: false,
  },
  {
    emoji: "📊",
    title: "Open Mission Control",
    desc: "Real-time session dashboard",
    to: null,
    disabled: true,
  },
  {
    emoji: "🔧",
    title: "Configure Agents",
    desc: "Edit agent definitions & configs",
    to: ROUTE_NAMES.configInjector,
    disabled: false,
  },
  {
    emoji: "🌳",
    title: "Manage Worktrees",
    desc: "Create, list, and prune worktrees",
    to: ROUTE_NAMES.worktreeManager,
    disabled: false,
  },
];

function navigateAction(action: QuickAction) {
  if (!action.disabled && action.to) {
    pushRoute(router, action.to);
  }
}
</script>

<template>
  <div class="panel">
    <div class="section-header">
      <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L12 14M12 2L8 6M12 2L16 6" /><path d="M5 18c0-3.87 3.13-7 7-7s7 3.13 7 7" />
      </svg>
      <span>Quick Actions</span>
    </div>
    <div class="actions-grid" data-testid="orchestration-actions">
      <div
        v-for="action in quickActions"
        :key="action.title"
        class="action-card"
        :class="{ disabled: action.disabled }"
        :data-testid="`action-${action.title.toLowerCase().replace(/\s+/g, '-')}`"
        tabindex="0"
        role="button"
        @click="navigateAction(action)"
        @keydown.enter="navigateAction(action)"
      >
        <div class="action-emoji-wrap">
          <span class="action-emoji">{{ action.emoji }}</span>
        </div>
        <div class="action-title">{{ action.title }}</div>
        <div class="action-desc">{{ action.desc }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  min-width: 0;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-muted);
}

.section-icon {
  flex-shrink: 0;
  color: var(--accent-fg);
}

.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action-card {
  padding: 20px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast),
    transform var(--transition-fast), box-shadow var(--transition-fast);
}

.action-card:hover:not(.disabled) {
  border-color: var(--accent-fg);
  background: var(--accent-muted);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.action-card:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.action-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-emoji-wrap {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--canvas-default);
  border-radius: var(--radius-md);
  font-size: 1.4rem;
  margin-bottom: 10px;
}

.action-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.action-desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.4;
}
</style>
