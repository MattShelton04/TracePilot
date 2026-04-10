<script setup lang="ts">
import { ErrorState, formatDate, LoadingSpinner, SearchInput, StatCard } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import TaskCard from "@/components/tasks/TaskCard.vue";
import { useAutoRefresh } from "@/composables/useAutoRefresh";
import { useOrchestratorStore } from "@/stores/orchestrator";
import { usePresetsStore } from "@/stores/presets";
import { useTasksStore } from "@/stores/tasks";

const store = useTasksStore();
const orchestrator = useOrchestratorStore();
const presets = usePresetsStore();
const router = useRouter();

const autoRefreshEnabled = ref(true);
const autoRefreshInterval = ref(5);

const { refreshing, refresh } = useAutoRefresh({
  onRefresh: async () => {
    await Promise.all([store.refreshTasks(), orchestrator.checkHealth()]);
  },
  enabled: autoRefreshEnabled,
  intervalSeconds: autoRefreshInterval,
});

onMounted(() => {
  store.fetchTasks();
  orchestrator.checkHealth();
  orchestrator.loadModels();
  presets.loadPresets();
});

function navigateToTask(taskId: string) {
  router.push(`/tasks/${taskId}`);
}

function navigateToNewTask() {
  router.push("/tasks/new");
}

const jobStatusColor = computed(() => {
  return (status: string) => {
    switch (status) {
      case "running":
        return "var(--accent-fg)";
      case "completed":
        return "var(--success-fg)";
      case "failed":
        return "var(--danger-fg)";
      case "cancelled":
        return "var(--text-tertiary)";
      default:
        return "var(--text-secondary)";
    }
  };
});

const hasActiveFilters = computed(
  () =>
    store.searchQuery.trim() !== "" || store.filterStatus !== "all" || store.filterType !== "all",
);

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

const orchUptime = computed(() => {
  if (!orchestrator.handle?.launchedAt) return null;
  const launched = new Date(orchestrator.handle.launchedAt).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - launched) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  return `${h}h ${m}m`;
});

const orchTaskProgress = computed(() => {
  if (!store.stats) return null;
  const { pending, inProgress, done, failed } = store.stats;
  // Only show tasks in the active pipeline — queued (pending + in_progress).
  // Done/failed are historical and shouldn't inflate the denominator.
  const queued = pending + inProgress;
  if (queued === 0) return null; // Nothing to process
  return {
    done,
    failed,
    pending,
    inProgress,
    total: queued,
    pct: 0, // 0% because none of the queued tasks are done yet
  };
});

function jobProgressPct(job: { tasksCompleted: number; taskCount: number }) {
  if (job.taskCount === 0) return 0;
  return Math.round((job.tasksCompleted / job.taskCount) * 100);
}

function jobProgressClass(status: string) {
  switch (status) {
    case "completed":
      return "job-progress-success";
    case "failed":
      return "job-progress-danger";
    case "running":
      return "job-progress-accent";
    default:
      return "job-progress-neutral";
  }
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Title Row -->
      <div class="page-title-row">
        <h1 class="page-title">
          <span class="title-icon-tile">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
            >
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5.5 8l2 2 3.5-4" />
            </svg>
          </span>
          Tasks
        </h1>
        <p class="page-subtitle">
          Manage and monitor your automation tasks
        </p>
        <div class="title-actions">
          <RefreshToolbar
            :refreshing="refreshing"
            :auto-refresh-enabled="autoRefreshEnabled"
            :interval-seconds="autoRefreshInterval"
            @refresh="refresh"
            @update:auto-refresh-enabled="autoRefreshEnabled = $event"
            @update:interval-seconds="autoRefreshInterval = $event"
          />
          <button class="btn btn--primary" @click="navigateToNewTask">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              width="14"
              height="14"
            >
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            New Task
          </button>
        </div>
      </div>

      <!-- Stats Strip -->
      <div v-if="store.stats" class="stats-strip">
        <div class="stat-card-wrapper stat-card--accent">
          <span class="stat-card-icon">
            <!-- grid icon -->
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
          </span>
          <StatCard
            :value="store.stats.total"
            label="Total"
            color="accent"
            mini
          />
        </div>
        <div class="stat-card-wrapper stat-card--warning">
          <span class="stat-card-icon">
            <!-- clock icon -->
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="13" height="13"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
          </span>
          <StatCard
            :value="store.stats.pending"
            label="Pending"
            color="warning"
            mini
          />
        </div>
        <div class="stat-card-wrapper stat-card--active">
          <span class="stat-card-icon">
            <!-- bolt icon -->
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polygon points="9 1 3 9 8 9 7 15 13 7 8 7 9 1" /></svg>
          </span>
          <StatCard
            :value="store.stats.inProgress"
            label="Active"
            color="accent"
            mini
          />
        </div>
        <div class="stat-card-wrapper stat-card--done">
          <span class="stat-card-icon">
            <!-- checkmark icon -->
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="13 4 6 12 3 9" /></svg>
          </span>
          <StatCard
            :value="store.stats.done"
            label="Done"
            color="done"
            mini
          />
        </div>
        <div class="stat-card-wrapper stat-card--danger">
          <span class="stat-card-icon">
            <!-- x-circle icon -->
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="13" height="13"><circle cx="8" cy="8" r="6" /><path d="M10 6L6 10M6 6l4 4" /></svg>
          </span>
          <StatCard
            :value="store.stats.failed"
            label="Failed"
            color="danger"
            mini
          />
        </div>
      </div>

      <!-- Orchestrator Status Card + Quick Presets -->
      <div class="dashboard-cards">
        <!-- Orchestrator Card -->
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
          <div v-if="orchTaskProgress && orchestrator.isRunning" class="orch-progress-strip">
            <div class="orch-progress-strip-header">
              <span class="orch-progress-strip-label">Task Queue</span>
              <span class="orch-progress-strip-value">
                <template v-if="orchTaskProgress.inProgress > 0">⟳ {{ orchTaskProgress.inProgress }} running</template>
                <template v-if="orchTaskProgress.inProgress > 0 && orchTaskProgress.pending > 0"> · </template>
                <template v-if="orchTaskProgress.pending > 0">◌ {{ orchTaskProgress.pending }} pending</template>
              </span>
            </div>
            <div class="orch-progress-bar">
              <div
                class="orch-progress-fill"
                :style="{ width: orchTaskProgress.total > 0 ? `${Math.round((orchTaskProgress.inProgress / orchTaskProgress.total) * 100)}%` : '0%' }"
              />
            </div>
          </div>
          <div v-if="orchestrator.error" class="orch-error">{{ orchestrator.error }}</div>
          <div class="orch-card-footer">
            <button class="orch-monitor-link" @click="router.push('/tasks/monitor')">
              Open Monitor →
            </button>
            <button
              v-if="orchestrator.sessionUuid"
              class="orch-monitor-link"
              @click="router.push(`/session/${orchestrator.sessionUuid}/overview`)"
            >
              View Session →
            </button>
          </div>
        </div>

        <!-- Quick Presets Card -->
        <div class="quick-presets-card">
          <div class="quick-presets-header">
            <span class="quick-presets-title">Quick Presets</span>
            <button class="orch-monitor-link" @click="router.push('/tasks/presets')">
              Manage →
            </button>
          </div>
          <div v-if="presets.enabledPresets.length === 0" class="quick-presets-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4; margin-bottom: 6px">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <span>No enabled presets</span>
          </div>
          <div v-else class="quick-preset-grid">
            <button
              v-for="preset in presets.enabledPresets.slice(0, 6)"
              :key="preset.id"
              class="quick-preset-card"
              @click="router.push({ path: '/tasks/new', query: { presetId: preset.id } })"
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
      </div>

      <!-- Filter Row -->
      <div class="filter-row">
        <SearchInput
          v-model="store.searchQuery"
          placeholder="Search tasks…"
          class="filter-search"
        />

        <select
          v-model="store.filterStatus"
          class="filter-select"
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="claimed">Claimed</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          v-model="store.filterType"
          class="filter-select"
          aria-label="Filter by type"
        >
          <option value="all">All Types</option>
          <option v-for="t in store.taskTypes" :key="t" :value="t">
            {{ t }}
          </option>
        </select>

        <select
          v-model="store.sortBy"
          class="filter-select"
          aria-label="Sort tasks"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="priority">Priority</option>
          <option value="status">Status</option>
        </select>
      </div>

      <!-- Loading State -->
      <div v-if="store.loading" class="state-center">
        <LoadingSpinner size="lg" />
        <p class="state-center__text">Loading tasks…</p>
      </div>

      <!-- Error State -->
      <ErrorState
        v-else-if="store.error"
        heading="Failed to load tasks"
        :message="store.error"
        @retry="store.fetchTasks()"
      />

      <!-- Task Grid -->
      <div v-else-if="store.filteredTasks.length > 0" class="task-grid">
        <TaskCard
          v-for="task in store.filteredTasks"
          :key="task.id"
          :task="task"
          @click="navigateToTask(task.id)"
        />
      </div>

      <!-- Empty State: no tasks at all -->
      <div v-else-if="store.tasks.length === 0" class="empty-state">
        <div class="empty-state__icon">📋</div>
        <h3 class="empty-state__title">No tasks yet</h3>
        <p class="empty-state__desc">
          Create your first task to start automating your workflow.
        </p>
        <div class="empty-state__actions">
          <button class="btn btn--primary" @click="navigateToNewTask">
            Create your first task
          </button>
        </div>
      </div>

      <!-- Empty State: filters hide everything -->
      <div v-else class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <h3 class="empty-state__title">No tasks match your filters</h3>
        <p class="empty-state__desc">
          Try adjusting your search or filter criteria.
        </p>
        <div v-if="hasActiveFilters" class="empty-state__actions">
          <button
            class="btn btn--secondary"
            @click="
              store.searchQuery = '';
              store.filterStatus = 'all';
              store.filterType = 'all';
            "
          >
            Clear Filters
          </button>
        </div>
      </div>

      <!-- Recent Jobs Section -->
      <div v-if="!store.loading && !store.error && store.jobs.length > 0" class="jobs-section">
        <h2 class="jobs-section__title">Recent Jobs</h2>
        <div class="jobs-table-wrap">
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in store.jobs" :key="job.id">
                <td class="jobs-table__name">{{ job.name }}</td>
                <td>
                  <span class="job-status-badge-wrap">
                    <span
                      class="job-status-dot"
                      :style="{ background: jobStatusColor(job.status) }"
                    />
                    <span
                      class="job-status-badge"
                      :style="{ color: jobStatusColor(job.status) }"
                    >
                      {{ job.status }}
                    </span>
                  </span>
                </td>
                <td class="jobs-table__progress">
                  <div class="job-progress-bar-wrap">
                    <div class="job-progress-bar">
                      <div
                        class="job-progress-fill"
                        :class="jobProgressClass(job.status)"
                        :style="{
                          width: `${jobProgressPct(job)}%`,
                        }"
                      />
                    </div>
                    <span class="job-progress-pct">{{ jobProgressPct(job) }}%</span>
                  </div>
                  <span class="jobs-table__counts">
                    {{ job.tasksCompleted }}/{{ job.taskCount }} done
                  </span>
                  <span v-if="job.tasksFailed > 0" class="jobs-table__failed">
                    · {{ job.tasksFailed }} failed
                  </span>
                </td>
                <td class="jobs-table__date">
                  {{ formatDate(job.createdAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Title Row ───────────────────────────────────────────── */
.page-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 4px;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  white-space: nowrap;
}

.title-icon-tile {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  border: 1px solid var(--border-accent, var(--accent-fg));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.title-icon-tile svg {
  width: 16px;
  height: 16px;
}

.page-subtitle {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin: 0;
  flex: 1;
  min-width: 180px;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

/* ── Stats Strip ─────────────────────────────────────────── */
.stats-strip {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 14px 0 4px;
  flex-wrap: wrap;
}

.stat-card-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  padding-left: 10px;
  border-left: 2px solid var(--border-default);
}

.stat-card-wrapper .stat-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm, 4px);
  flex-shrink: 0;
}

.stat-card--accent {
  border-left-color: var(--accent-fg);
}

.stat-card--accent .stat-card-icon {
  color: var(--accent-fg);
  background: var(--accent-muted);
}

.stat-card--warning {
  border-left-color: var(--warning-fg);
}

.stat-card--warning .stat-card-icon {
  color: var(--warning-fg);
  background: var(--warning-subtle);
}

.stat-card--active {
  border-left-color: var(--accent-fg);
}

.stat-card--active .stat-card-icon {
  color: var(--accent-fg);
  background: var(--accent-muted);
}

.stat-card--done {
  border-left-color: var(--success-fg);
}

.stat-card--done .stat-card-icon {
  color: var(--success-fg);
  background: var(--success-subtle);
}

.stat-card--danger {
  border-left-color: var(--danger-fg);
}

.stat-card--danger .stat-card-icon {
  color: var(--danger-fg);
  background: var(--danger-subtle);
}

/* ── Dashboard Cards (Orchestrator + Quick Presets) ──────────── */
.dashboard-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

.orch-card,
.quick-presets-card {
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
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  max-width: 140px;
}

.orch-model-select:focus {
  border-color: var(--accent);
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
  color: var(--neutral-emphasis);
}
.state-color-starting {
  color: var(--accent-fg);
}

.job-progress-success {
  background: var(--success-fg);
}
.job-progress-danger {
  background: var(--danger-fg);
}
.job-progress-accent {
  background: var(--accent-fg);
}
.job-progress-neutral {
  background: var(--text-tertiary);
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

/* Quick Presets */
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

/* ── Filter Row ──────────────────────────────────────────── */
.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 20px;
  flex-wrap: wrap;
}

.filter-search {
  flex: 1;
  min-width: 180px;
  max-width: 280px;
}

.filter-select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='%2371717a'%3E%3Cpath d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}

.filter-select:focus {
  border-color: var(--accent-fg);
}

.filter-select option {
  background: var(--canvas-default);
  color: var(--text-primary);
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md, 8px);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  font-family: inherit;
}

.btn svg {
  width: 14px;
  height: 14px;
}

.btn--primary {
  background: var(--gradient-accent, var(--accent-emphasis));
  border: 1px solid transparent;
  color: var(--text-on-emphasis);
  font-weight: 600;
  box-shadow: 0 1px 6px var(--accent-muted);
}

.btn--primary:hover:not(:disabled) {
  box-shadow: 0 3px 14px var(--accent-muted);
  transform: translateY(-1px);
}

.btn--primary:active {
  transform: translateY(0);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn--secondary {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.btn--secondary:hover {
  color: var(--text-primary);
  border-color: var(--accent-fg);
  background: var(--accent-subtle, var(--canvas-inset));
}

.btn--ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.btn--ghost:hover {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.btn--ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Task Grid ───────────────────────────────────────────── */
.task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}

/* ── Loading State ───────────────────────────────────────── */
.state-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  gap: 16px;
}

.state-center__text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

/* ── Empty State ─────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-state__icon {
  font-size: 3rem;
  margin-bottom: 12px;
}

.empty-state__title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.empty-state__desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 20px;
}

.empty-state__actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

/* ── Recent Jobs Section ─────────────────────────────────── */
.jobs-section {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-default);
}

.jobs-section__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 14px;
  letter-spacing: -0.01em;
}

.jobs-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--canvas-subtle);
}

.jobs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.jobs-table th {
  text-align: left;
  padding: 10px 14px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}

.jobs-table td {
  padding: 10px 14px;
  color: var(--text-secondary);
  border-bottom: 1px solid
    var(--border-muted);
  vertical-align: middle;
}

.jobs-table tbody tr:last-child td {
  border-bottom: none;
}

.jobs-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.jobs-table__name {
  color: var(--text-primary);
  font-weight: 500;
}

.job-status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}

.jobs-table__progress {
  font-variant-numeric: tabular-nums;
}

.jobs-table__counts {
  color: var(--text-secondary);
}

.jobs-table__failed {
  color: var(--danger-fg);
  font-weight: 500;
}

.jobs-table__date {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.job-status-badge-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.job-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.job-progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.job-progress-bar {
  flex: 1;
  height: 3px;
  background: var(--border-default);
  border-radius: 999px;
  overflow: hidden;
  min-width: 60px;
}

.job-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s ease;
}

.job-progress-pct {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}

/* ── Utilities ───────────────────────────────────────────── */
.spin-animation {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 640px) {
  .page-title-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .title-actions {
    margin-left: 0;
    width: 100%;
  }

  .filter-row {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-search {
    max-width: none;
  }

  .task-grid {
    grid-template-columns: 1fr;
  }

  .stats-strip {
    gap: 8px;
  }

  .dashboard-cards {
    grid-template-columns: 1fr;
  }
}
</style>
