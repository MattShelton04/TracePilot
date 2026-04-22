<script setup lang="ts">
import type { TaskStats } from "@tracepilot/types";
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useOrchestratorStore } from "@/stores/orchestrator";

const props = defineProps<{
  stats: TaskStats | null;
}>();

const orchestrator = useOrchestratorStore();
const router = useRouter();

const stateLabel = computed(() => {
  if (orchestrator.starting) return "Starting…";
  switch (orchestrator.health?.health) {
    case "healthy":
      return "Running";
    case "stale":
      return "Stale";
    case "stopped":
      return "Stopped";
    case "unknown":
      return orchestrator.handle ? "Starting…" : "Unknown";
    default:
      return orchestrator.handle ? "Starting…" : "Idle";
  }
});

const stateColorClass = computed(() => {
  switch (orchestrator.health?.health) {
    case "healthy":
      return "state-color-healthy";
    case "stale":
      return "state-color-stale";
    case "stopped":
      return "state-color-stopped";
    default:
      return orchestrator.handle ? "state-color-starting" : "state-color-stopped";
  }
});

const nowMs = ref(Date.now());
const _uptimeClock = setInterval(() => { nowMs.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(_uptimeClock));

const orchUptime = computed(() => {
  if (!orchestrator.handle?.launchedAt) return null;
  const launched = new Date(orchestrator.handle.launchedAt).getTime();
  const diffSec = Math.floor((nowMs.value - launched) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  return `${h}h ${m}m`;
});

const taskProgress = computed(() => {
  if (!props.stats) return null;
  const { pending, inProgress, done, failed } = props.stats;
  const queued = pending + inProgress;
  if (queued === 0) return null;
  return { done, failed, pending, inProgress, total: queued, pct: 0 };
});
</script>

<template>
  <div class="orch-card">
    <div class="orch-card-header">
      <div class="orch-card-title">
        <span
          class="orch-dot"
          :class="orchestrator.isRunning ? 'dot-green' : orchestrator.isStale ? 'dot-warning' : 'dot-gray'"
        />
        Orchestrator
        <span class="orch-state-label" :class="stateColorClass">
          {{ stateLabel }}
        </span>
      </div>
      <div class="orch-header-controls">
        <select
          v-if="orchestrator.isStopped && orchestrator.models.length > 0"
          v-model="orchestrator.selectedModel"
          class="orch-model-select"
        >
          <option v-for="m in orchestrator.models" :key="m.id" :value="m.id">
            {{ m.name }}
          </option>
        </select>
        <button
          v-if="orchestrator.isStopped"
          class="orch-action-btn orch-start"
          :disabled="orchestrator.starting"
          @click="orchestrator.startOrchestrator()"
        >
          {{ orchestrator.starting ? "Starting…" : "Start" }}
        </button>
        <button
          v-else
          class="orch-action-btn orch-stop"
          :disabled="orchestrator.stopping"
          @click="orchestrator.stopOrchestrator()"
        >
          {{ orchestrator.stopping ? "Stopping…" : "Stop" }}
        </button>
      </div>
    </div>
    <div class="orch-card-stats">
      <div class="orch-stat">
        <span class="orch-stat-value">{{ orchestrator.health?.lastCycle ?? "—" }}</span>
        <span class="orch-stat-label">Cycles</span>
      </div>
      <div class="orch-stat">
        <span class="orch-stat-value">{{ orchestrator.health?.activeTasks?.length ?? 0 }}</span>
        <span class="orch-stat-label">Active</span>
      </div>
      <div class="orch-stat">
        <span
          class="orch-stat-value"
          :class="{ 'stale-text': orchestrator.isStale }"
        >
          {{ orchestrator.health?.heartbeatAgeSecs != null ? `${orchestrator.health.heartbeatAgeSecs}s` : "—" }}
        </span>
        <span class="orch-stat-label">Heartbeat</span>
      </div>
      <div v-if="orchUptime" class="orch-stat">
        <span class="orch-stat-value">{{ orchUptime }}</span>
        <span class="orch-stat-label">Uptime</span>
      </div>
    </div>
    <!-- Task progress indicator -->
    <div v-if="taskProgress && orchestrator.isRunning" class="orch-progress-strip">
      <div class="orch-progress-strip-header">
        <span class="orch-progress-strip-label">Task Queue</span>
        <span class="orch-progress-strip-value">
          <template v-if="taskProgress.inProgress > 0">⟳ {{ taskProgress.inProgress }} running</template>
          <template v-if="taskProgress.inProgress > 0 && taskProgress.pending > 0"> · </template>
          <template v-if="taskProgress.pending > 0">◌ {{ taskProgress.pending }} pending</template>
        </span>
      </div>
      <div class="orch-progress-bar">
        <div
          class="orch-progress-fill"
          :style="{ width: taskProgress.total > 0 ? `${Math.round((taskProgress.inProgress / taskProgress.total) * 100)}%` : '0%' }"
        />
      </div>
    </div>
    <div v-if="orchestrator.error" class="orch-error">{{ orchestrator.error }}</div>
    <div class="orch-card-footer">
      <button class="orch-monitor-link" @click="pushRoute(router, ROUTE_NAMES.taskMonitor)">
        Open Monitor →
      </button>
      <button
        v-if="orchestrator.sessionUuid"
        class="orch-monitor-link"
        @click="pushRoute(router, ROUTE_NAMES.sessionOverview, { params: { id: orchestrator.sessionUuid } })"
      >
        View Session →
      </button>
    </div>
  </div>
</template>

<style scoped>
.orch-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  min-width: 0;
  overflow: hidden;
}

.orch-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.orch-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.orch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-green {
  background: var(--success-fg);
  box-shadow: 0 0 6px var(--success-muted);
}

.dot-gray {
  background: var(--neutral-emphasis);
}

.dot-warning {
  background: var(--warning-fg);
  box-shadow: 0 0 6px var(--warning-muted);
}

.orch-state-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.orch-action-btn {
  padding: 4px 14px;
  font-size: 0.6875rem;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.orch-header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.orch-model-select {
  padding: 3px 8px;
  font-size: 0.6875rem;
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  max-width: 140px;
}

.orch-model-select:focus {
  border-color: var(--accent-fg);
  outline: none;
}

.orch-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.orch-start {
  background: var(--success-fg);
  color: var(--text-inverse);
}

.orch-start:hover:not(:disabled) {
  background: var(--success-emphasis);
}

.orch-stop {
  background: var(--danger-fg);
  color: var(--text-inverse);
}

.orch-stop:hover:not(:disabled) {
  background: var(--danger-emphasis);
}

.orch-card-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 12px;
}

.orch-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.orch-stat-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.orch-stat-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.orch-error {
  font-size: 0.75rem;
  color: var(--danger-fg);
  margin-bottom: 8px;
}

.orch-card-footer {
  display: flex;
  align-items: center;
  gap: 16px;
}

.orch-progress-strip {
  margin-bottom: 12px;
}

.orch-progress-strip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.orch-progress-strip-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.orch-progress-strip-value {
  font-size: 0.6875rem;
  color: var(--accent-fg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.orch-progress-bar {
  height: 4px;
  background: var(--border-default);
  border-radius: 999px;
  overflow: hidden;
}

.orch-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent-fg);
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.orch-monitor-link {
  background: none;
  border: none;
  color: var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  transition: opacity var(--transition-fast);
}

.orch-monitor-link:hover {
  opacity: 0.8;
}

.stale-text {
  color: var(--warning-fg);
}

.state-color-healthy {
  color: var(--success-fg);
}
.state-color-stale {
  color: var(--warning-fg);
}
.state-color-stopped {
  color: var(--text-tertiary);
}
.state-color-starting {
  color: var(--accent-fg);
}
</style>
