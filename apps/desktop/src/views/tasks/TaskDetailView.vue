<script setup lang="ts">
import { isTerminalStatus } from "@tracepilot/types";
import {
  ErrorState,
  formatDate,
  LoadingSpinner,
  SectionPanel,
  useConfirmDialog,
  useToast,
} from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PriorityBadge from "@/components/tasks/PriorityBadge.vue";
import TaskStatusBadge from "@/components/tasks/TaskStatusBadge.vue";
import TaskTypeBadge from "@/components/tasks/TaskTypeBadge.vue";
import { taskTitle, useTasksStore } from "@/stores/tasks";

const route = useRoute();
const router = useRouter();
const store = useTasksStore();
const toast = useToast();
const { confirm } = useConfirmDialog();

const taskId = computed(() => route.params.taskId as string);
const task = computed(() => store.selectedTask);
const loading = ref(false);
const cancelling = ref(false);
const retrying = ref(false);

const canCancel = computed(() => {
  const s = task.value?.status;
  return s === "pending" || s === "claimed" || s === "in_progress";
});

const canRetry = computed(() => {
  const s = task.value?.status;
  return s === "failed" || s === "expired" || s === "dead_letter";
});

async function loadTask(id: string) {
  loading.value = true;
  await store.getTask(id);
  loading.value = false;
}

async function handleCancel() {
  if (!task.value) return;
  cancelling.value = true;
  const ok = await store.cancelTask(task.value.id);
  cancelling.value = false;
  if (ok) {
    toast.success("Task cancelled");
    await store.getTask(task.value.id);
  } else {
    toast.error(store.error ?? "Failed to cancel task");
  }
}

async function handleRetry() {
  if (!task.value) return;
  retrying.value = true;
  const ok = await store.retryTask(task.value.id);
  retrying.value = false;
  if (ok) {
    toast.success("Task queued for retry");
    await store.getTask(task.value.id);
  } else {
    toast.error(store.error ?? "Failed to retry task");
  }
}

async function handleDelete() {
  if (!task.value) return;
  const { confirmed } = await confirm({
    title: "Delete Task",
    message: `Are you sure you want to permanently delete this task? This action cannot be undone.`,
    variant: "danger",
    confirmLabel: "Yes, Delete",
  });
  if (!confirmed) return;
  const ok = await store.deleteTask(task.value.id);
  if (ok) {
    toast.success("Task deleted");
    router.push("/tasks");
  } else {
    toast.error(store.error ?? "Failed to delete task");
  }
}

function goBack() {
  router.push("/tasks");
}

onMounted(() => {
  if (taskId.value) loadTask(taskId.value);
});

watch(taskId, (newId) => {
  if (newId) loadTask(newId);
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Top bar -->
      <div class="detail-topbar">
        <button class="back-link" @click="goBack">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back to Tasks
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="loading-state">
        <LoadingSpinner size="lg" />
        <span class="loading-label">Loading task…</span>
      </div>

      <!-- Error -->
      <ErrorState
        v-else-if="!task && store.error"
        heading="Failed to load task"
        :message="store.error"
        @retry="loadTask(taskId)"
      />

      <!-- Not found -->
      <div v-else-if="!task && !loading" class="not-found">
        <p>Task "{{ taskId }}" was not found.</p>
        <button class="btn btn-secondary" @click="goBack">Back to Tasks</button>
      </div>

      <!-- Task detail -->
      <template v-if="task">
        <!-- Header -->
        <div class="detail-header">
          <div class="detail-header-left">
            <h1 class="detail-title">{{ taskTitle(task) }}</h1>
            <div class="detail-badges">
              <TaskStatusBadge :status="task.status" />
              <TaskTypeBadge :task-type="task.taskType" />
              <PriorityBadge :priority="task.priority" />
            </div>
          </div>
          <div class="detail-actions">
            <button
              v-if="canCancel"
              class="btn btn-warning"
              :disabled="cancelling"
              @click="handleCancel"
            >
              {{ cancelling ? "Cancelling…" : "Cancel" }}
            </button>
            <button
              v-if="canRetry"
              class="btn btn-accent"
              :disabled="retrying"
              @click="handleRetry"
            >
              {{ retrying ? "Retrying…" : "Retry" }}
            </button>
            <button class="btn btn-danger" @click="handleDelete">Delete</button>
          </div>
        </div>

        <!-- Metadata -->
        <SectionPanel title="Task Metadata">
          <div class="meta-grid">
            <div class="meta-row">
              <span class="meta-label">Task ID</span>
              <span class="meta-value mono truncate">{{ task.id }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Type</span>
              <span class="meta-value">
                <TaskTypeBadge :task-type="task.taskType" />
              </span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Preset</span>
              <span class="meta-value mono">{{ task.presetId }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Priority</span>
              <span class="meta-value">
                <PriorityBadge :priority="task.priority" />
              </span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Status</span>
              <span class="meta-value">
                <TaskStatusBadge :status="task.status" />
              </span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Created</span>
              <span class="meta-value">{{ formatDate(task.createdAt) }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Updated</span>
              <span class="meta-value">{{ formatDate(task.updatedAt) }}</span>
            </div>
            <div v-if="task.completedAt" class="meta-row">
              <span class="meta-label">Completed</span>
              <span class="meta-value">{{ formatDate(task.completedAt) }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Attempts</span>
              <span class="meta-value mono">
                {{ task.attemptCount }} / {{ task.maxRetries }}
              </span>
            </div>
            <div v-if="task.jobId" class="meta-row">
              <span class="meta-label">Job ID</span>
              <span class="meta-value">
                <router-link class="meta-link" :to="`/tasks?jobId=${task.jobId}`">
                  {{ task.jobId }}
                </router-link>
              </span>
            </div>
            <div v-if="task.orchestratorSessionId" class="meta-row">
              <span class="meta-label">Orchestrator Session</span>
              <span class="meta-value mono truncate">
                {{ task.orchestratorSessionId }}
              </span>
            </div>
            <div v-if="task.contextHash" class="meta-row">
              <span class="meta-label">Context Hash</span>
              <span class="meta-value mono truncate">{{ task.contextHash }}</span>
            </div>
            <div v-if="task.schemaValid != null" class="meta-row">
              <span class="meta-label">Schema Valid</span>
              <span class="meta-value">
                <span :class="task.schemaValid ? 'valid-check' : 'invalid-cross'">
                  {{ task.schemaValid ? "✓ Yes" : "✗ No" }}
                </span>
              </span>
            </div>
          </div>
        </SectionPanel>

        <!-- Input Parameters -->
        <SectionPanel title="Input Parameters">
          <div class="json-block-wrapper">
            <pre class="json-block">{{ JSON.stringify(task.inputParams, null, 2) }}</pre>
          </div>
        </SectionPanel>

        <!-- Result (if done) -->
        <SectionPanel v-if="task.status === 'done'" title="Result">
          <div v-if="task.resultSummary" class="result-summary">
            {{ task.resultSummary }}
          </div>
          <div v-if="task.resultParsed" class="json-block-wrapper">
            <pre class="json-block">{{ JSON.stringify(task.resultParsed, null, 2) }}</pre>
          </div>
          <div
            v-if="!task.resultSummary && !task.resultParsed"
            class="empty-placeholder"
          >
            No result data available.
          </div>
        </SectionPanel>

        <!-- Error (if failed) -->
        <SectionPanel
          v-if="task.errorMessage"
          title="Error"
        >
          <div class="error-block">
            <span class="error-icon">✗</span>
            <span class="error-text">{{ task.errorMessage }}</span>
          </div>
        </SectionPanel>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ─── Layout ─── */
.detail-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  border: none;
  background: none;
}

.back-link:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}

/* ─── Loading ─── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 64px 0;
}

.loading-label {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

/* ─── Not Found ─── */
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

/* ─── Header ─── */
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.detail-header-left {
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0 0 8px 0;
}

.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ─── Buttons ─── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.btn:hover {
  color: var(--text-primary);
  border-color: var(--border-accent);
  background: var(--neutral-subtle);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  border-color: var(--border-default);
}

.btn-warning {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.3);
}

.btn-warning:hover {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.5);
}

.btn-accent {
  color: #818cf8;
  border-color: rgba(129, 140, 248, 0.3);
}

.btn-accent:hover {
  background: rgba(129, 140, 248, 0.1);
  border-color: rgba(129, 140, 248, 0.5);
}

.btn-danger {
  color: var(--danger-fg, #f87171);
  border-color: rgba(248, 113, 113, 0.3);
}

.btn-danger:hover {
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.5);
}

/* ─── Metadata Grid ─── */
.meta-grid {
  display: flex;
  flex-direction: column;
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.meta-row:last-child {
  border-bottom: none;
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  min-width: 140px;
  flex-shrink: 0;
}

.meta-value {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.mono {
  font-family: "JetBrains Mono", var(--font-mono, monospace);
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-link {
  color: #818cf8;
  text-decoration: none;
  font-family: "JetBrains Mono", var(--font-mono, monospace);
  font-size: 0.8125rem;
}

.meta-link:hover {
  text-decoration: underline;
}

.valid-check {
  color: #34d399;
  font-weight: 500;
}

.invalid-cross {
  color: #f87171;
  font-weight: 500;
}

/* ─── JSON Block ─── */
.json-block-wrapper {
  overflow: auto;
  max-height: 400px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.25);
}

.json-block {
  font-family: "JetBrains Mono", var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary, #a1a1aa);
  padding: 16px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ─── Result ─── */
.result-summary {
  font-size: 0.875rem;
  color: var(--text-primary);
  line-height: 1.55;
  margin-bottom: 12px;
  padding: 12px 16px;
  background: rgba(52, 211, 153, 0.06);
  border: 1px solid rgba(52, 211, 153, 0.15);
  border-radius: var(--radius-md);
}

.empty-placeholder {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
}

/* ─── Error Block ─── */
.error-block {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  background: rgba(248, 113, 113, 0.06);
  border: 1px solid rgba(248, 113, 113, 0.15);
  border-radius: var(--radius-md);
}

.error-icon {
  color: #f87171;
  font-weight: 700;
  font-size: 0.875rem;
  flex-shrink: 0;
  line-height: 1.55;
}

.error-text {
  font-size: 0.8125rem;
  color: #f87171;
  line-height: 1.55;
  word-break: break-word;
}

/* ─── Responsive ─── */
@media (max-width: 640px) {
  .detail-header {
    flex-direction: column;
  }

  .detail-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .meta-label {
    min-width: 100px;
  }
}
</style>
