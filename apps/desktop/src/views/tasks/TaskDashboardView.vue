<script setup lang="ts">
import { ErrorState, formatDate, LoadingSpinner, SearchInput, StatCard } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import TaskCard from "@/components/tasks/TaskCard.vue";
import { useOrchestratorStore } from "@/stores/orchestrator";
import { usePresetsStore } from "@/stores/presets";
import { useTasksStore } from "@/stores/tasks";

const store = useTasksStore();
const orchestrator = useOrchestratorStore();
const presets = usePresetsStore();
const router = useRouter();
const refreshing = ref(false);

onMounted(() => {
  store.fetchTasks();
  orchestrator.checkHealth();
  presets.loadPresets();
});

async function handleRefresh() {
  refreshing.value = true;
  await store.refreshTasks();
  refreshing.value = false;
}

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
  const { total, done, failed } = store.stats;
  if (total === 0) return null;
  const completed = done + failed;
  return { completed, total, pct: Math.round((completed / total) * 100) };
});

function jobProgressPct(job: { tasksCompleted: number; taskCount: number }) {
  if (job.taskCount === 0) return 0;
  return Math.round((job.tasksCompleted / job.taskCount) * 100);
}

function jobProgressColor(status: string) {
  switch (status) {
    case "completed":
      return "#34d399";
    case "failed":
      return "#f87171";
    case "running":
      return "var(--accent-fg)";
    default:
      return "var(--text-tertiary)";
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
          <button
            class="btn btn--ghost"
            :disabled="refreshing"
            @click="handleRefresh"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              :class="{ 'spin-animation': refreshing }"
            >
              <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
              <path d="M13 3v4h-4M3 13V9h4" />
            </svg>
            {{ refreshing ? "Refreshing…" : "Refresh" }}
          </button>
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
              <span class="orch-state-label" :style="{ color: stateColor }">
                {{ stateLabel }}
              </span>
            </div>
            <button
              v-if="orchestrator.isStopped"
              class="orch-action-btn orch-start"
              :disabled="orchestrator.starting"
              @click="orchestrator.startOrchestrator('gpt-5-mini')"
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
              <span class="orch-progress-strip-label">Task Progress</span>
              <span class="orch-progress-strip-value">
                {{ orchTaskProgress.completed }}/{{ orchTaskProgress.total }}
                ({{ orchTaskProgress.pct }}%)
              </span>
            </div>
            <div class="orch-progress-bar">
              <div
                class="orch-progress-fill"
                :style="{ width: `${orchTaskProgress.pct}%` }"
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
              @click="router.push(`/sessions/${orchestrator.sessionUuid}`)"
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
            No enabled presets
          </div>
          <div v-else class="quick-preset-grid">
            <div
              v-for="preset in presets.enabledPresets.slice(0, 4)"
              :key="preset.id"
              class="quick-preset-card"
            >
              <div class="quick-preset-card-top">
                <span class="quick-preset-name">{{ preset.name }}</span>
                <span v-if="preset.builtin" class="quick-preset-builtin">BUILT-IN</span>
              </div>
              <p v-if="preset.description" class="quick-preset-desc">
                {{ preset.description }}
              </p>
              <div class="quick-preset-card-footer">
                <div class="quick-preset-tags">
                  <span
                    v-for="tag in preset.tags.slice(0, 2)"
                    :key="tag"
                    class="quick-preset-tag"
                  >
                    {{ tag }}
                  </span>
                  <span v-if="!preset.tags.length" class="quick-preset-type-label">
                    {{ preset.taskType }}
                  </span>
                </div>
                <button
                  class="quick-preset-run"
                  @click="router.push({ path: '/tasks/new', query: { presetId: preset.id } })"
                >
                  Run
                </button>
              </div>
            </div>
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
                        :style="{
                          width: `${jobProgressPct(job)}%`,
                          background: jobProgressColor(job.status),
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
  border-left-color: var(--accent-fg, #818cf8);
}

.stat-card--accent .stat-card-icon {
  color: var(--accent-fg, #818cf8);
  background: var(--accent-muted, rgba(99, 102, 241, 0.12));
}

.stat-card--warning {
  border-left-color: #fbbf24;
}

.stat-card--warning .stat-card-icon {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
}

.stat-card--active {
  border-left-color: var(--accent-fg, #818cf8);
}

.stat-card--active .stat-card-icon {
  color: var(--accent-fg, #818cf8);
  background: var(--accent-muted, rgba(99, 102, 241, 0.12));
}

.stat-card--done {
  border-left-color: #34d399;
}

.stat-card--done .stat-card-icon {
  color: #34d399;
  background: rgba(52, 211, 153, 0.12);
}

.stat-card--danger {
  border-left-color: #f87171;
}

.stat-card--danger .stat-card-icon {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
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
  background: #34d399;
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
}

.dot-gray {
  background: #71717a;
}

.dot-warning {
  background: #fbbf24;
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.5);
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

.orch-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.orch-start {
  background: #34d399;
  color: #09090b;
}

.orch-start:hover:not(:disabled) {
  background: #2dd890;
}

.orch-stop {
  background: #f87171;
  color: #09090b;
}

.orch-stop:hover:not(:disabled) {
  background: #f55858;
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
  color: #fbbf24;
}

.orch-stat-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.orch-error {
  font-size: 0.75rem;
  color: #f87171;
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
  background: var(--border-default, rgba(255, 255, 255, 0.06));
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
  font-size: 0.8125rem;
  color: var(--text-placeholder);
  text-align: center;
  padding: 20px 0;
}

.quick-preset-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-preset-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition:
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.quick-preset-card:hover {
  border-color: var(--accent-fg);
  transform: translateY(-1px);
}

.quick-preset-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
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
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.quick-preset-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.4;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-preset-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: auto;
}

.quick-preset-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.quick-preset-tag {
  font-size: 0.5625rem;
  padding: 1px 6px;
  border-radius: var(--radius-sm, 4px);
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  border: 1px solid var(--border-default);
  white-space: nowrap;
}

.quick-preset-type-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.quick-preset-run {
  padding: 3px 10px;
  font-size: 0.6875rem;
  font-weight: 600;
  background: var(--accent-muted);
  color: var(--accent-fg);
  border: 1px solid var(--accent-fg);
  border-radius: var(--radius-md);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.quick-preset-run:hover {
  background: var(--accent-fg);
  color: #09090b;
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
  background: var(--canvas-subtle, #111113);
  color: var(--text-secondary, #a1a1aa);
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
  border-color: var(--accent-fg, #818cf8);
}

.filter-select option {
  background: var(--canvas-default, #09090b);
  color: var(--text-primary, #fafafa);
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
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 6px rgba(99, 102, 241, 0.35);
}

.btn--primary:hover:not(:disabled) {
  box-shadow: 0 3px 14px rgba(99, 102, 241, 0.45);
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
  border-top: 1px solid var(--border-default, rgba(255, 255, 255, 0.06));
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
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
  background: var(--canvas-subtle, #111113);
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
  color: var(--text-tertiary, #71717a);
  border-bottom: 1px solid var(--border-default, rgba(255, 255, 255, 0.06));
  white-space: nowrap;
}

.jobs-table td {
  padding: 10px 14px;
  color: var(--text-secondary, #a1a1aa);
  border-bottom: 1px solid
    var(--border-muted, rgba(255, 255, 255, 0.03));
  vertical-align: middle;
}

.jobs-table tbody tr:last-child td {
  border-bottom: none;
}

.jobs-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.jobs-table__name {
  color: var(--text-primary, #fafafa);
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
  color: var(--text-secondary, #a1a1aa);
}

.jobs-table__failed {
  color: var(--danger-fg, #f87171);
  font-weight: 500;
}

.jobs-table__date {
  color: var(--text-tertiary, #71717a);
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
  background: var(--border-default, rgba(255, 255, 255, 0.06));
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

  .quick-preset-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-cards {
    grid-template-columns: 1fr;
  }
}
</style>
