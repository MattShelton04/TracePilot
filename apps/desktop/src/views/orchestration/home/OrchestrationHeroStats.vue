<script setup lang="ts">
import { formatBytes } from "@tracepilot/ui";
import { computed } from "vue";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";

const store = useOrchestrationHomeStore();

const idleSessions = computed(() => Math.max(0, store.totalSessions - store.activeSessions));
</script>

<template>
  <div class="hero-grid">
    <!-- Active Sessions -->
    <div class="hero-card accent">
      <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L12 14M12 2L8 6M12 2L16 6" /><path d="M5 18c0-3.87 3.13-7 7-7s7 3.13 7 7" /><circle cx="12" cy="22" r="1" fill="currentColor" />
      </svg>
      <div class="hero-value">{{ store.activeSessions }}</div>
      <div class="hero-label">Active Sessions</div>
      <div class="hero-sub">{{ store.activeSessions }} working, {{ idleSessions }} idle</div>
    </div>

    <!-- Worktrees -->
    <div class="hero-card success">
      <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      <div class="hero-value">{{ store.registeredRepos.length || '—' }}</div>
      <div class="hero-label">Repositories</div>
      <div class="hero-sub" v-if="store.worktreeCount > 0">{{ store.worktreeCount }} worktrees · {{ store.staleWorktreeCount }} stale · {{ formatBytes(store.totalDiskUsage) }}</div>
      <div class="hero-sub" v-else-if="store.registeredRepos.length > 0">No worktrees yet</div>
      <div class="hero-sub" v-else>No repos registered yet</div>
    </div>

    <!-- Budget Used (Commented out until wired up) -->
    <!--
    <div class="hero-card warning">
      <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
      <div class="hero-value">{{ budgetPercent }}%</div>
      <div class="hero-label">Budget Used</div>
      <div class="budget-bar">
        <div
          class="budget-bar-fill"
          :class="budgetBarClass"
          :style="{ width: budgetPercent + '%' }"
        />
      </div>
    </div>
    -->

    <!-- Placeholder N/A Budget Tile -->
    <div class="hero-card warning opacity-50">
      <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
      <div class="hero-value">N/A</div>
      <div class="hero-label">Budget Used</div>
      <div class="hero-sub">Not currently available</div>
    </div>

    <!-- Total Sessions -->
    <div class="hero-card done">
      <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
      <div class="hero-value">{{ store.totalSessions }}</div>
      <div class="hero-label">Total Sessions</div>
      <div class="hero-sub">All-time indexed sessions</div>
    </div>
  </div>
</template>

<style scoped>
.hero-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}

.hero-card {
  position: relative;
  padding: 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  overflow: hidden;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.hero-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.hero-card.accent {
  background: linear-gradient(135deg, var(--accent-muted), var(--canvas-subtle));
  border-color: var(--accent-fg);
}

.hero-card.success {
  background: linear-gradient(135deg, var(--success-muted), var(--canvas-subtle));
  border-color: var(--success-fg);
}

.hero-card.warning {
  background: linear-gradient(135deg, var(--warning-muted), var(--canvas-subtle));
  border-color: var(--warning-fg);
}

.hero-card.done {
  background: linear-gradient(135deg, var(--done-muted), var(--canvas-subtle));
  border-color: var(--done-fg);
}

.hero-icon {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  opacity: 0.3;
}

.hero-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.hero-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-top: 4px;
}

.hero-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.budget-bar {
  height: 6px;
  background: var(--canvas-inset);
  border-radius: 3px;
  margin-top: 10px;
  overflow: hidden;
}

.budget-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--transition-normal);
}

.budget-bar-fill.ok {
  background: var(--success-fg);
}

.budget-bar-fill.warning {
  background: var(--warning-fg);
}

.budget-bar-fill.danger {
  background: var(--danger-fg);
}
</style>
