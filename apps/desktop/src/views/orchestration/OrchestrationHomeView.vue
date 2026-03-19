<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useOrchestrationHomeStore } from '@/stores/orchestrationHome';

const store = useOrchestrationHomeStore();

onMounted(() => {
  store.initialize();
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Loading State -->
      <div v-if="store.loading" class="loading-state">
        <div class="loading-spinner" />
        <p>Loading command center…</p>
      </div>

      <!-- Error State -->
      <div v-else-if="store.error" class="error-state">
        <div class="error-icon">⚠</div>
        <p>Failed to load: {{ store.error }}</p>
        <button class="btn btn-primary" @click="store.initialize()">Retry</button>
      </div>

      <!-- Main Content -->
      <template v-else>
        <!-- Page Header -->
        <div class="page-header">
          <div class="page-header-text">
            <h1 class="page-title">Command Center</h1>
            <p class="page-subtitle">Monitor system health, launch sessions, and manage orchestration workflows.</p>
          </div>
          <div class="health-badge" :class="store.isHealthy ? 'health-badge--ok' : 'health-badge--error'">
            <span class="health-dot" />
            {{ store.isHealthy ? 'System Healthy' : 'System Degraded' }}
          </div>
        </div>

        <!-- Hero Stat Cards -->
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-card-value accent">{{ store.totalSessions }}</div>
            <div class="stat-card-label">Total Sessions</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value" :class="store.activeSessions > 0 ? 'success' : ''">
              {{ store.activeSessions }}
            </div>
            <div class="stat-card-label">Active Sessions</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value" :class="store.isHealthy ? 'success' : 'danger'">
              {{ store.isHealthy ? 'Operational' : 'Degraded' }}
            </div>
            <div class="stat-card-label">System Status</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">
              {{ store.systemDeps?.copilotVersion || '—' }}
            </div>
            <div class="stat-card-label">Copilot Version</div>
          </div>
        </div>

        <!-- System Dependencies Detail -->
        <div v-if="store.systemDeps" class="deps-row">
          <div class="dep-chip" :class="store.systemDeps.gitAvailable ? 'dep-chip--ok' : 'dep-chip--missing'">
            <span class="dep-dot" />
            Git {{ store.systemDeps.gitAvailable ? 'Available' : 'Missing' }}
          </div>
          <div class="dep-chip" :class="store.systemDeps.copilotAvailable ? 'dep-chip--ok' : 'dep-chip--missing'">
            <span class="dep-dot" />
            Copilot CLI {{ store.systemDeps.copilotAvailable ? 'Available' : 'Missing' }}
          </div>
        </div>

        <!-- Quick Actions -->
        <h2 class="section-title">Quick Actions</h2>
        <div class="actions-grid">
          <RouterLink to="/orchestration/launcher" class="action-card">
            <span class="action-icon">🚀</span>
            <span class="action-label">New Session</span>
            <span class="action-desc">Launch a new Copilot session with custom configuration</span>
          </RouterLink>
          <RouterLink to="/orchestration/worktrees" class="action-card">
            <span class="action-icon">🌳</span>
            <span class="action-label">Manage Worktrees</span>
            <span class="action-desc">Create, list, and prune Git worktrees</span>
          </RouterLink>
          <RouterLink to="/orchestration/config" class="action-card">
            <span class="action-icon">⚙️</span>
            <span class="action-label">Config Injector</span>
            <span class="action-desc">Edit agent definitions and Copilot config</span>
          </RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Loading & Error States ─────────────────────────────────── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 80px 24px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary);
}

.error-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}

.error-state .btn {
  margin-top: 12px;
}

/* ── Page Header ────────────────────────────────────────────── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.page-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.health-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}

.health-badge--ok {
  background: color-mix(in srgb, var(--success-fg) 12%, transparent);
  color: var(--success-fg);
}

.health-badge--error {
  background: color-mix(in srgb, var(--danger-fg) 12%, transparent);
  color: var(--danger-fg);
}

.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

/* ── Hero Stat Cards ────────────────────────────────────────── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  transition: box-shadow 0.15s, border-color 0.15s;
}

.stat-card:hover {
  border-color: var(--border-accent, var(--border-default));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.stat-card-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  margin-bottom: 4px;
}

.stat-card-value.accent {
  color: var(--accent-fg);
}

.stat-card-value.success {
  color: var(--success-fg);
}

.stat-card-value.danger {
  color: var(--danger-fg);
}

.stat-card-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ── System Dependencies Row ────────────────────────────────── */
.deps-row {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.dep-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.dep-chip--ok {
  background: color-mix(in srgb, var(--success-fg) 10%, transparent);
  color: var(--success-fg);
}

.dep-chip--missing {
  background: color-mix(in srgb, var(--danger-fg) 10%, transparent);
  color: var(--danger-fg);
}

.dep-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* ── Section Title ──────────────────────────────────────────── */
.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

/* ── Quick Action Cards ─────────────────────────────────────── */
.actions-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 20px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.action-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.action-icon {
  font-size: 1.5rem;
  line-height: 1;
}

.action-label {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.action-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
