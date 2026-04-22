<script setup lang="ts">
import {
  ErrorState,
  LoadingSpinner,
  PageShell,
  SearchInput,
  StatCard,
  useAutoRefresh,
} from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import OrchestratorStatusCard from "@/components/tasks/OrchestratorStatusCard.vue";
import QuickPresetsCard from "@/components/tasks/QuickPresetsCard.vue";
import RecentJobsTable from "@/components/tasks/RecentJobsTable.vue";
import TaskCard from "@/components/tasks/TaskCard.vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
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
  pushRoute(router, ROUTE_NAMES.taskDetail, { params: { taskId } });
}

function navigateToNewTask() {
  pushRoute(router, ROUTE_NAMES.taskCreate);
}

const hasActiveFilters = computed(
  () =>
    store.searchQuery.trim() !== "" || store.filterStatus !== "all" || store.filterType !== "all",
);
</script>

<template>
  <PageShell>
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
        <OrchestratorStatusCard :stats="store.stats" />
        <QuickPresetsCard :presets="presets.enabledPresets" />
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
            @click="store.resetFilters()"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <!-- Recent Jobs Section -->
      <RecentJobsTable
        v-if="!store.loading && !store.error && store.jobs.length > 0"
        :jobs="store.jobs"
      />
  </PageShell>
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