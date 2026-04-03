<script setup lang="ts">
import { ErrorState, formatDate, LoadingSpinner, SectionPanel, StatCard } from "@tracepilot/ui";
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import TaskStatusBadge from "@/components/tasks/TaskStatusBadge.vue";
import { useOrchestratorStore } from "@/stores/orchestrator";

const orchestrator = useOrchestratorStore();
const router = useRouter();

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

function truncateId(id: string, len = 12): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function truncateError(err: string | null, len = 60): string {
  if (!err) return "";
  return err.length > len ? `${err.slice(0, len)}…` : err;
}

function viewSession() {
  const uuid = orchestrator.sessionUuid;
  if (uuid) {
    router.push({ path: `/session/${uuid}/overview` });
  }
}

// ── Lifecycle ───────────────────────────────────────────────
onMounted(() => {
  orchestrator.refresh();
  orchestrator.startPolling();
});

onUnmounted(() => {
  orchestrator.stopPolling();
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Header -->
      <div class="page-header fade-section" style="--stagger: 0">
        <h1 class="page-title">Orchestrator Monitor</h1>
        <div class="header-actions">
          <button
            v-if="orchestrator.isStopped"
            class="action-btn start-btn"
            :disabled="orchestrator.starting"
            @click="orchestrator.startOrchestrator('gpt-5-mini')"
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
          <button
            class="refresh-btn"
            :disabled="orchestrator.loading"
            @click="orchestrator.refresh()"
          >
            <svg
              class="refresh-icon"
              :class="{ spinning: orchestrator.loading }"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path
                d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.418A6 6 0 1 1 8 2v1z"
              />
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
            </svg>
            {{ orchestrator.loading ? "Refreshing…" : "Refresh" }}
          </button>
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
                :stroke-dasharray="orchestrator.isRunning ? '327' : '82 245'"
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

        <!-- Session Link (when orchestrator session is discovered) -->
        <div v-if="orchestrator.sessionUuid" class="session-link-bar fade-section" style="--stagger: 3">
          <span class="session-link-label">Orchestrator Session:</span>
          <button class="session-link-btn" @click="viewSession">
            <span class="cell-mono">{{ orchestrator.sessionUuid }}</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" />
            </svg>
          </button>
        </div>

        <!-- Active Tasks (from heartbeat) -->
        <SectionPanel title="Active Tasks" class="fade-section" style="--stagger: 4">
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
          <div v-else class="task-id-list">
            <div
              v-for="taskId in orchestrator.health?.activeTasks ?? []"
              :key="taskId"
              class="task-id-chip"
            >
              <TaskStatusBadge status="in_progress" />
              <span class="cell-mono">{{ truncateId(taskId, 20) }}</span>
            </div>
          </div>
        </SectionPanel>

        <!-- Active Subagents (from attribution) -->
        <SectionPanel title="Active Subagents" class="fade-section" style="--stagger: 5">
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
          <div v-else class="table-wrapper">
            <table class="data-table" aria-label="Active subagents">
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="agent in orchestrator.activeSubagents" :key="agent.taskId">
                  <td class="cell-mono">{{ truncateId(agent.taskId) }}</td>
                  <td class="cell-name">{{ agent.agentName }}</td>
                  <td>
                    <span class="subagent-badge subagent-running">
                      <span class="subagent-badge-dot" />
                      {{ agent.status }}
                    </span>
                  </td>
                  <td class="cell-date">{{ agent.startedAt ? formatDate(agent.startedAt) : "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionPanel>

        <!-- Completed Subagents (from attribution) -->
        <SectionPanel title="Completed Subagents" class="fade-section" style="--stagger: 6">
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
          <div v-else class="table-wrapper">
            <table class="data-table" aria-label="Completed subagents">
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Completed</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="agent in orchestrator.completedSubagents" :key="agent.taskId">
                  <td class="cell-mono">{{ truncateId(agent.taskId) }}</td>
                  <td class="cell-name">{{ agent.agentName }}</td>
                  <td>
                    <span class="subagent-badge" :class="`subagent-${agent.status}`">
                      <span class="subagent-badge-dot" />
                      {{ agent.status }}
                    </span>
                  </td>
                  <td class="cell-date">{{ agent.completedAt ? formatDate(agent.completedAt) : "—" }}</td>
                  <td class="cell-error">
                    <span v-if="agent.error" class="error-text" :title="agent.error">
                      {{ truncateError(agent.error) }}
                    </span>
                    <span v-else class="no-error">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
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

/* ── Session Link Bar ────────────────────────────────────────── */
.session-link-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.session-link-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.session-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--accent-fg);
  font-size: 0.8125rem;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.session-link-btn:hover {
  background: var(--canvas-overlay);
  border-color: var(--accent-fg);
}

/* ── Task ID List ────────────────────────────────────────────── */
.task-id-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}

.task-id-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
}

/* ── Table ───────────────────────────────────────────────────── */
.table-wrapper {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.data-table th {
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}

.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  vertical-align: middle;
}

.data-table tbody tr {
  transition: background var(--transition-fast);
}

.data-table tbody tr:hover {
  background: var(--canvas-subtle);
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-mono {
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", monospace);
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.cell-name {
  font-weight: 500;
}

.cell-date {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.cell-error {
  max-width: 240px;
}

.error-text {
  font-size: 0.75rem;
  color: #f87171;
  cursor: help;
}

.no-error {
  color: var(--text-placeholder);
}

/* ── Subagent Status Badges ──────────────────────────────────── */
.subagent-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.subagent-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.subagent-running {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}

.subagent-running .subagent-badge-dot,
.subagent-spawning .subagent-badge-dot {
  background: #34d399;
  animation: pulse 1.5s ease-in-out infinite;
}

.subagent-spawning {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}

.subagent-completed {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}

.subagent-completed .subagent-badge-dot {
  background: #34d399;
}

.subagent-failed {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
}

.subagent-failed .subagent-badge-dot {
  background: #f87171;
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
}
</style>
