<script setup lang="ts">
import { ErrorState, LoadingSpinner, SectionPanel, StatCard } from "@tracepilot/ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import TaskStatusBadge from "@/components/tasks/TaskStatusBadge.vue";
import { useAutoRefresh } from "@/composables/useAutoRefresh";
import { useOrchestratorStore } from "@/stores/orchestrator";

const orchestrator = useOrchestratorStore();
const router = useRouter();
const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
const healthExpanded = ref(false);

const autoRefreshEnabled = ref(true);
const autoRefreshInterval = ref(5);

const { refreshing, refresh: autoRefresh } = useAutoRefresh({
  onRefresh: () => orchestrator.pollCycle(),
  enabled: autoRefreshEnabled,
  intervalSeconds: autoRefreshInterval,
});

// ── Derived state ───────────────────────────────────────────
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

const stateColor = computed(() => {
  switch (orchestrator.health?.health) {
    case "healthy":
      return "#34d399";
    case "stale":
      return "#fbbf24";
    case "stopped":
      return "#71717a";
    default:
      return orchestrator.handle ? "#818cf8" : "#71717a";
  }
});

const heartbeatDisplay = computed(() => {
  const secs = orchestrator.health?.heartbeatAgeSecs;
  if (secs == null) return "No heartbeat";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
});

const heartbeatColor = computed<"success" | "warning" | "danger">(() => {
  const secs = orchestrator.health?.heartbeatAgeSecs;
  if (secs == null) return "danger";
  if (secs < 30) return "success";
  if (secs < 60) return "warning";
  return "danger";
});

const activeTaskCount = computed(() => orchestrator.health?.activeTasks?.length ?? 0);
const lastCycle = computed(() => orchestrator.health?.lastCycle ?? null);

// Ring fill: full circle (327) when healthy, partial when stale, quarter when stopped/unknown
const ringDasharray = computed(() => {
  switch (orchestrator.health?.health) {
    case "healthy":
      return "327";
    case "stale":
      return "164 163";
    case "stopped":
      return "82 245";
    default:
      return orchestrator.handle ? "245 82" : "82 245";
  }
});

// Uptime since orchestrator was launched
const uptimeDisplay = computed(() => {
  const launched = orchestrator.handle?.launchedAt;
  if (!launched || !orchestrator.isRunning) return null;
  const diffMs = now.value - new Date(launched).getTime();
  if (diffMs < 0) return null;
  const secs = Math.floor(diffMs / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${secs % 60}s`;
});

function truncateId(id: string, len = 12): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function truncateError(err: string | null, len = 60): string {
  if (!err) return "";
  return err.length > len ? `${err.slice(0, len)}…` : err;
}

function elapsedSince(isoDate: string | null): string {
  if (!isoDate) return "—";
  const diffMs = now.value - new Date(isoDate).getTime();
  if (diffMs < 0) return "0s";
  const secs = Math.floor(diffMs / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function durationBetween(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (diffMs < 0) return "—";
  const secs = Math.floor(diffMs / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function viewSession() {
  const uuid = orchestrator.sessionUuid;
  if (uuid) {
    router.push({ path: `/session/${uuid}/overview` });
  }
}

function viewTask(taskId: string) {
  router.push({ path: `/tasks/${taskId}` });
}

// ── Lifecycle ───────────────────────────────────────────────
onMounted(() => {
  orchestrator.refresh();
  orchestrator.loadModels();
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Header -->
      <div class="page-header fade-section" style="--stagger: 0">
        <h1 class="page-title">Orchestrator Monitor</h1>
        <div class="header-actions">
          <select
            v-if="orchestrator.isStopped && orchestrator.models.length > 0"
            v-model="orchestrator.selectedModel"
            class="model-select"
          >
            <option v-for="m in orchestrator.models" :key="m.id" :value="m.id">
              {{ m.name }}
            </option>
          </select>
          <button
            v-if="orchestrator.isStopped"
            class="action-btn start-btn"
            :disabled="orchestrator.starting"
            @click="orchestrator.startOrchestrator()"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2l10 6-10 6z" />
            </svg>
            {{ orchestrator.starting ? "Starting…" : "Start" }}
          </button>
          <button
            v-else
            class="action-btn stop-btn"
            :disabled="orchestrator.stopping"
            @click="orchestrator.stopOrchestrator()"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1" />
            </svg>
            {{ orchestrator.stopping ? "Stopping…" : "Stop" }}
          </button>
          <RefreshToolbar
            :refreshing="refreshing"
            :auto-refresh-enabled="autoRefreshEnabled"
            :interval-seconds="autoRefreshInterval"
            @refresh="autoRefresh"
            @update:auto-refresh-enabled="autoRefreshEnabled = $event"
            @update:interval-seconds="autoRefreshInterval = $event"
          />
        </div>
      </div>

      <!-- Error state -->
      <ErrorState
        v-if="orchestrator.error && !orchestrator.health"
        heading="Health check failed"
        :message="orchestrator.error"
        @retry="orchestrator.refresh()"
      />

      <!-- Loading state (initial load only) -->
      <div v-else-if="orchestrator.loading && !orchestrator.health" class="loading-container">
        <LoadingSpinner />
        <span class="loading-text">Checking orchestrator health…</span>
      </div>

      <template v-else>
        <!-- Status Hero -->
        <section class="status-hero fade-section" style="--stagger: 1" aria-label="Orchestrator status">
          <div class="status-ring-container">
            <svg class="status-ring" width="120" height="120" viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="var(--border-default)"
                stroke-width="4"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                :stroke="stateColor"
                stroke-width="4"
                stroke-linecap="round"
                :stroke-dasharray="ringDasharray"
                stroke-dashoffset="0"
                class="status-ring-progress"
              />
              <circle
                cx="60"
                cy="60"
                r="8"
                :fill="stateColor"
                class="status-ring-dot"
                :class="{ pulsing: orchestrator.isRunning }"
              />
            </svg>
          </div>
          <div class="status-info">
            <div class="status-label" :style="{ color: stateColor }">{{ stateLabel }}</div>
            <div class="status-heartbeat">
              Last heartbeat: <strong>{{ heartbeatDisplay }}</strong>
            </div>
            <div class="hero-meta">
              <div v-if="orchestrator.handle?.pid" class="hero-meta-item">
                <span class="hero-meta-label">PID</span>
                <span class="hero-meta-value">{{ orchestrator.handle.pid }}</span>
              </div>
              <div v-if="uptimeDisplay" class="hero-meta-item">
                <span class="hero-meta-label">Uptime</span>
                <span class="hero-meta-value">{{ uptimeDisplay }}</span>
              </div>
            </div>
            <div class="hero-actions">
              <button
                v-if="orchestrator.sessionUuid"
                class="session-hero-btn"
                @click="viewSession"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path
                    d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"
                  />
                </svg>
                View Session
              </button>
            </div>
            <div v-if="orchestrator.needsRestart" class="needs-restart-badge">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path
                  d="M8.22 1.754a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047zM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-.25-5.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5z"
                />
              </svg>
              Needs Restart
            </div>
            <div v-if="orchestrator.error" class="inline-error">
              {{ orchestrator.error }}
            </div>
          </div>
        </section>

        <!-- Health Stats -->
        <div class="stats-grid fade-section" style="--stagger: 2">
          <StatCard
            :value="orchestrator.health?.heartbeatAgeSecs != null ? `${orchestrator.health.heartbeatAgeSecs}s` : '—'"
            label="Heartbeat Age"
            :color="heartbeatColor"
          />
          <StatCard
            :value="lastCycle != null ? lastCycle : '—'"
            label="Last Cycle"
            color="accent"
          />
          <StatCard
            :value="activeTaskCount"
            label="Active Tasks"
            color="accent"
          />
          <StatCard
            :value="orchestrator.lastIngestedCount"
            label="Last Ingested"
            color="done"
          />
        </div>

        <!-- Active Tasks (from heartbeat) -->
        <SectionPanel title="Active Tasks" class="fade-section" style="--stagger: 3">
          <template #actions>
            <span class="subagent-count-badge">{{ activeTaskCount }}</span>
          </template>
          <div v-if="activeTaskCount === 0" class="empty-state">
            <svg
              class="empty-icon"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <span>No active tasks</span>
          </div>
          <div v-else class="active-task-grid">
            <button
              v-for="taskId in orchestrator.health?.activeTasks ?? []"
              :key="taskId"
              class="active-task-card"
              @click="viewTask(taskId)"
            >
              <div class="active-task-top">
                <TaskStatusBadge status="in_progress" />
                <span class="active-task-id cell-mono">{{ truncateId(taskId, 20) }}</span>
              </div>
              <div class="active-task-footer">
                <span class="sa-link">View Task →</span>
              </div>
            </button>
          </div>
        </SectionPanel>

        <!-- Active Subagents (from attribution) -->
        <SectionPanel title="Active Subagents" class="fade-section" style="--stagger: 4">
          <template #actions>
            <span class="subagent-count-badge">{{ orchestrator.activeSubagents.length }}</span>
          </template>
          <div v-if="orchestrator.activeSubagents.length === 0" class="empty-state">
            <svg
              class="empty-icon"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <span>{{ orchestrator.sessionUuid ? "No active subagents" : "Waiting for session discovery…" }}</span>
          </div>
          <div v-else class="subagent-grid">
            <div
              v-for="agent in orchestrator.activeSubagents"
              :key="agent.taskId"
              class="subagent-card"
            >
              <div class="subagent-card-top">
                <span class="subagent-name cell-mono">{{ truncateId(agent.taskId) }}</span>
                <span class="subagent-status-badge" :class="agent.status">
                  <span v-if="agent.status === 'running' || agent.status === 'spawning'" class="spinner-xs" />
                  <svg
                    v-else
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path
                      d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
                    />
                  </svg>
                  {{ agent.status }}
                </span>
              </div>
              <div v-if="agent.agentName" class="subagent-task-title">{{ agent.agentName }}</div>
              <div class="subagent-card-meta">
                <span class="subagent-elapsed">⏱ {{ elapsedSince(agent.startedAt) }}</span>
              </div>
              <div class="subagent-progress">
                <div class="subagent-progress-fill" :class="agent.status" />
              </div>
              <div class="subagent-card-footer">
                <button class="sa-link" @click="viewTask(agent.taskId)">View Task →</button>
              </div>
            </div>
          </div>
        </SectionPanel>

        <!-- Completed Subagents (from attribution) -->
        <SectionPanel title="Completed Subagents" class="fade-section" style="--stagger: 5">
          <template #actions>
            <span class="subagent-count-badge">{{ orchestrator.completedSubagents.length }}</span>
          </template>
          <div v-if="orchestrator.completedSubagents.length === 0" class="empty-state">
            <svg
              class="empty-icon"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>No completed subagents yet</span>
          </div>
          <div v-else class="subagent-grid">
            <div
              v-for="agent in orchestrator.completedSubagents"
              :key="agent.taskId"
              class="subagent-card"
              :class="{ 'card-failed': agent.status === 'failed' }"
            >
              <div class="subagent-card-top">
                <span class="subagent-name cell-mono">{{ truncateId(agent.taskId) }}</span>
                <span class="subagent-status-badge" :class="agent.status">
                  <svg
                    v-if="agent.status === 'completed'"
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path
                      d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
                    />
                  </svg>
                  <svg
                    v-else-if="agent.status === 'failed'"
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path
                      d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
                    />
                  </svg>
                  {{ agent.status }}
                </span>
              </div>
              <div v-if="agent.agentName" class="subagent-task-title">{{ agent.agentName }}</div>
              <div class="subagent-card-meta">
                <span class="subagent-elapsed">{{ durationBetween(agent.startedAt, agent.completedAt) }}</span>
              </div>
              <div v-if="agent.error" class="completed-error" :title="agent.error">
                {{ truncateError(agent.error, 40) }}
              </div>
              <div class="subagent-card-footer">
                <button class="sa-link" @click="viewTask(agent.taskId)">View Task →</button>
              </div>
            </div>
          </div>
        </SectionPanel>

        <!-- Health & Recovery -->
        <SectionPanel title="Health & Recovery" class="fade-section" style="--stagger: 6">
          <template #actions>
            <button class="collapse-toggle" @click="healthExpanded = !healthExpanded">
              {{ healthExpanded ? "Collapse" : "Expand" }}
            </button>
          </template>
          <div class="health-summary">
            <div class="health-badge" :class="orchestrator.health?.health ?? 'stopped'">
              <span class="health-dot" />
              {{ orchestrator.health?.health ?? "unknown" }}
            </div>
            <span v-if="orchestrator.error" class="health-error-inline">
              {{ truncateError(orchestrator.error, 50) }}
            </span>
          </div>
          <div v-if="healthExpanded" class="health-grid">
            <div class="health-item">
              <span class="health-item-label">Needs Restart</span>
              <span class="health-item-value">{{ orchestrator.needsRestart ? "Yes" : "No" }}</span>
            </div>
            <div class="health-item">
              <span class="health-item-label">Last Error</span>
              <span class="health-item-value">{{ orchestrator.error ?? "None" }}</span>
            </div>
            <div class="health-item">
              <span class="health-item-label">Poll Interval</span>
              <span class="health-item-value">5 000 ms</span>
            </div>
            <div class="health-item">
              <span class="health-item-label">Stale Threshold</span>
              <span class="health-item-value">60 s</span>
            </div>
            <div class="health-policy">
              <strong>Recovery Policy:</strong> The orchestrator always starts a fresh Copilot session on launch —
              it never resumes a prior session. If the process is detected as stale or crashed, a full restart is
              triggered with a new session UUID.
            </div>
          </div>
        </SectionPanel>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Animations ──────────────────────────────────────────────── */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.fade-section {
  animation: fadeInUp 0.4s ease-out both;
  animation-delay: calc(var(--stagger, 0) * 0.08s);
}

/* ── Action Buttons ──────────────────────────────────────────── */
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background var(--transition-fast),
    opacity var(--transition-fast);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.start-btn {
  background: #34d399;
  color: #09090b;
}

.start-btn:hover:not(:disabled) {
  background: #2dd890;
}

.stop-btn {
  background: #f87171;
  color: #09090b;
}

.stop-btn:hover:not(:disabled) {
  background: #f55858;
}

/* ── Header ──────────────────────────────────────────────────── */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.model-select {
  padding: 5px 10px;
  font-size: 0.75rem;
  background: var(--canvas-subtle);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  max-width: 160px;
}

.model-select:focus {
  border-color: var(--accent);
  outline: none;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.refresh-btn:hover:not(:disabled) {
  background: var(--canvas-overlay);
  border-color: var(--accent-fg);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  flex-shrink: 0;
}

.refresh-icon.spinning {
  animation: spin 0.8s linear infinite;
}

/* ── Loading ─────────────────────────────────────────────────── */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 64px 0;
}

.loading-text {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

/* ── Status Hero ─────────────────────────────────────────────── */
.status-hero {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 28px 32px;
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
}

.status-ring-container {
  flex-shrink: 0;
}

.status-ring-progress {
  transition:
    stroke 0.3s ease,
    stroke-dasharray 0.3s ease;
}

.status-ring-dot.pulsing {
  animation: pulse 2s ease-in-out infinite;
}

.status-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-label {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
}

.status-heartbeat {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.status-heartbeat strong {
  color: var(--text-secondary);
}

/* ── Hero Meta (PID / Model / Uptime) ────────────────────────── */
.hero-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.hero-meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.6875rem;
}

.hero-meta-label {
  color: var(--text-placeholder);
  font-weight: 500;
}

.hero-meta-value {
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", monospace);
  font-weight: 500;
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

/* ── Hero Actions ────────────────────────────────────────────── */
.hero-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.session-hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--accent-fg);
  font-size: 0.6875rem;
  font-weight: 600;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.session-hero-btn:hover {
  background: var(--canvas-overlay);
  border-color: var(--accent-fg);
}

.needs-restart-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  width: fit-content;
}

.inline-error {
  font-size: 0.75rem;
  color: #f87171;
  margin-top: 2px;
}

/* ── Stats Grid ──────────────────────────────────────────────── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

/* ── Subagent Count Badge ────────────────────────────────────── */
.subagent-count-badge {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

/* ── Empty States ────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
  color: var(--text-placeholder);
  font-size: 0.8125rem;
}

.empty-icon {
  opacity: 0.4;
}

/* ── Active Task Cards ────────────────────────────────────────── */
.active-task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  padding: 4px 0;
}

.active-task-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
  text-align: left;
  font-family: inherit;
  color: inherit;
}

.active-task-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-fg);
}

.active-task-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.active-task-id {
  font-size: 0.75rem;
}

.active-task-footer {
  display: flex;
  justify-content: flex-end;
}

/* ── Subagent Card Grid ──────────────────────────────────────── */
.subagent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.subagent-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.subagent-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-fg);
}

.subagent-card.card-failed {
  border-color: rgba(248, 113, 113, 0.3);
}

.subagent-card.card-failed:hover {
  border-color: #f87171;
  box-shadow: 0 0 0 1px #f87171;
}

.subagent-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.subagent-name {
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", monospace);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent-fg);
}

.subagent-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.subagent-status-badge.running {
  background: rgba(99, 102, 241, 0.12);
  color: var(--accent-fg);
}

.subagent-status-badge.spawning {
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
}

.subagent-status-badge.completed {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}

.subagent-status-badge.failed {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
}

.spinner-xs {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--border-default);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.subagent-task-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
}

.subagent-card-meta {
  display: flex;
  gap: 10px;
  align-items: center;
}

.subagent-elapsed {
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", monospace);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.subagent-progress {
  height: 3px;
  border-radius: 2px;
  background: var(--border-default);
  overflow: hidden;
}

.subagent-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent-fg);
  animation: indeterminate 1.5s ease-in-out infinite;
}

.subagent-progress-fill.spawning {
  background: #fbbf24;
}

.subagent-progress-fill.completed,
.subagent-progress-fill.failed {
  animation: none;
  width: 100%;
}

.subagent-progress-fill.completed {
  background: #34d399;
}

.subagent-progress-fill.failed {
  background: #f87171;
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
    width: 40%;
  }
  50% {
    transform: translateX(60%);
    width: 60%;
  }
  100% {
    transform: translateX(200%);
    width: 40%;
  }
}

.subagent-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: auto;
}

.sa-link {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--accent-fg);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
  transition: opacity var(--transition-fast);
}

.sa-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.completed-error {
  font-size: 0.6875rem;
  color: #f87171;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Health & Recovery ───────────────────────────────────────── */
.collapse-toggle {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--accent-fg);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-family: inherit;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.collapse-toggle:hover {
  background: var(--canvas-overlay);
}

.health-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.health-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: capitalize;
}

.health-badge.healthy {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.15);
}

.health-badge.stale {
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.15);
}

.health-badge.stopped,
.health-badge.unknown {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.15);
}

.health-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.health-error-inline {
  font-size: 0.6875rem;
  color: #f87171;
}

.health-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.health-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.health-item-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-placeholder);
}

.health-item-value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-word;
}

.health-policy {
  grid-column: 1 / -1;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  border: 1px solid var(--border-default);
  line-height: 1.6;
}

.health-policy strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.cell-mono {
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", monospace);
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* ── Responsive ──────────────────────────────────────────────── */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .status-hero {
    flex-direction: column;
    text-align: center;
    gap: 16px;
    padding: 24px 20px;
  }

  .status-info {
    align-items: center;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .subagent-grid {
    grid-template-columns: 1fr;
  }

  .active-task-grid {
    grid-template-columns: 1fr;
  }

  .health-grid {
    grid-template-columns: 1fr;
  }
}
</style>
