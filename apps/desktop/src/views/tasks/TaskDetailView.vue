<script setup lang="ts">
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
const activeTab = ref<"result" | "context" | "timeline" | "raw">("result");
const copiedSection = ref<string | null>(null);

const canCancel = computed(() => {
  const s = task.value?.status;
  return s === "pending" || s === "claimed" || s === "in_progress";
});

const canRetry = computed(() => {
  const s = task.value?.status;
  return s === "failed" || s === "expired" || s === "dead_letter";
});

const duration = computed(() => {
  const t = task.value;
  if (!t?.completedAt) return null;
  const ms = new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
});

const timelineEvents = computed(() => {
  const t = task.value;
  if (!t) return [];
  const events: { label: string; time: string | null; icon: string; color: string }[] = [
    { label: "Created", time: t.createdAt, icon: "●", color: "var(--text-tertiary)" },
  ];
  if (t.status === "in_progress") {
    events.push({ label: "In Progress", time: t.updatedAt, icon: "▶", color: "#60a5fa" });
  }
  if (t.completedAt && t.status === "done") {
    events.push({ label: "Completed", time: t.completedAt, icon: "✓", color: "#34d399" });
  } else if (t.completedAt && t.status === "failed") {
    events.push({ label: "Failed", time: t.completedAt, icon: "✗", color: "#f87171" });
  } else if (t.completedAt && t.status === "cancelled") {
    events.push({ label: "Cancelled", time: t.completedAt, icon: "⊘", color: "#fbbf24" });
  }
  return events;
});

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function copyJson(label: string, data: unknown) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    copiedSection.value = label;
    setTimeout(() => {
      copiedSection.value = null;
    }, 2000);
  } catch {
    toast.error("Failed to copy");
  }
}

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
    message: "Are you sure you want to permanently delete this task? This action cannot be undone.",
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
            <div class="detail-meta-row">
              <TaskStatusBadge :status="task.status" />
              <TaskTypeBadge :task-type="task.taskType" />
              <PriorityBadge :priority="task.priority" />
              <span class="detail-id">{{ task.id.slice(0, 12) }}…</span>
              <span class="detail-sep">·</span>
              <span class="detail-date">{{ formatDate(task.createdAt) }}</span>
              <template v-if="duration">
                <span class="detail-sep">·</span>
                <span class="detail-duration">⏱ {{ duration }}</span>
              </template>
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

        <!-- Tab Bar -->
        <div class="tab-bar">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'result' }"
            @click="activeTab = 'result'"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5.5 8l2 2 3.5-4" stroke-linecap="round" stroke-linejoin="round" />
              <rect x="2" y="2" width="12" height="12" rx="2" />
            </svg>
            Result
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'context' }"
            @click="activeTab = 'context'"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="12" height="12" rx="1" />
              <path d="M5 5h6M5 8h4M5 11h5" stroke-linecap="round" />
            </svg>
            Context
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'timeline' }"
            @click="activeTab = 'timeline'"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4v4l3 2" stroke-linecap="round" />
            </svg>
            Timeline
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'raw' }"
            @click="activeTab = 'raw'"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 3L2 8l3 5M11 3l3 5-3 5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Raw
          </button>
        </div>

        <!-- ─── Result Tab ─── -->
        <div v-if="activeTab === 'result'" class="tab-panel">
          <!-- Pending/in-progress empty state -->
          <div
            v-if="task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'"
            class="result-empty"
          >
            <div class="result-empty-icon">⏳</div>
            <h3 class="result-empty-title">No results yet</h3>
            <p class="result-empty-desc">
              This task is {{ task.status === "in_progress" ? "currently being processed" : "waiting to be processed" }}.
            </p>
          </div>

          <!-- Error state -->
          <div v-else-if="task.errorMessage" class="result-section">
            <div class="error-block">
              <span class="error-icon">✗</span>
              <div class="error-content">
                <span class="error-label">Task Failed</span>
                <span class="error-text">{{ task.errorMessage }}</span>
              </div>
            </div>
          </div>

          <!-- Result content -->
          <template v-else>
            <div v-if="task.resultSummary" class="result-section">
              <h3 class="section-heading">Summary</h3>
              <div class="result-summary">{{ task.resultSummary }}</div>
            </div>

            <div v-if="task.resultParsed" class="result-section">
              <h3 class="section-heading">Parsed Result</h3>
              <div class="json-block-wrapper">
                <pre class="json-block">{{ JSON.stringify(task.resultParsed, null, 2) }}</pre>
              </div>
            </div>

            <div
              v-if="!task.resultSummary && !task.resultParsed && !task.errorMessage"
              class="result-empty"
            >
              <div class="result-empty-icon">📋</div>
              <h3 class="result-empty-title">No result data</h3>
              <p class="result-empty-desc">
                This task completed but no result data was recorded.
              </p>
            </div>
          </template>

          <!-- Metadata summary at bottom -->
          <div class="meta-summary">
            <div class="meta-chip">
              <span class="meta-chip-label">Attempts</span>
              <span class="meta-chip-value">{{ task.attemptCount }} / {{ task.maxRetries }}</span>
            </div>
            <div v-if="task.schemaValid != null" class="meta-chip">
              <span class="meta-chip-label">Schema</span>
              <span class="meta-chip-value" :class="task.schemaValid ? 'valid-check' : 'invalid-cross'">
                {{ task.schemaValid ? "✓ Valid" : "✗ Invalid" }}
              </span>
            </div>
            <div v-if="task.contextHash" class="meta-chip">
              <span class="meta-chip-label">Context</span>
              <span class="meta-chip-value mono">{{ task.contextHash.slice(0, 10) }}…</span>
            </div>
          </div>
        </div>

        <!-- ─── Context Tab ─── -->
        <div v-if="activeTab === 'context'" class="tab-panel">
          <div class="context-section">
            <h3 class="section-heading">Preset</h3>
            <div class="context-card">
              <div class="context-row">
                <span class="context-label">Preset ID</span>
                <span class="context-value mono">{{ task.presetId }}</span>
              </div>
              <div class="context-row">
                <span class="context-label">Task Type</span>
                <span class="context-value"><TaskTypeBadge :task-type="task.taskType" /></span>
              </div>
              <div class="context-row">
                <span class="context-label">Priority</span>
                <span class="context-value"><PriorityBadge :priority="task.priority" /></span>
              </div>
            </div>
          </div>

          <div class="context-section">
            <h3 class="section-heading">Input Parameters</h3>
            <div v-if="task.inputParams && Object.keys(task.inputParams).length > 0" class="context-card">
              <div
                v-for="(val, key) in task.inputParams"
                :key="String(key)"
                class="context-row"
              >
                <span class="context-label">{{ String(key) }}</span>
                <span class="context-value mono">
                  {{ typeof val === "string" ? val : JSON.stringify(val) }}
                </span>
              </div>
            </div>
            <div v-else class="empty-placeholder">No input parameters</div>
          </div>

          <div v-if="task.jobId" class="context-section">
            <h3 class="section-heading">Execution</h3>
            <div class="context-card">
              <div class="context-row">
                <span class="context-label">Job ID</span>
                <span class="context-value mono">{{ task.jobId }}</span>
              </div>
              <div v-if="task.orchestratorSessionId" class="context-row">
                <span class="context-label">Orchestrator Session</span>
                <span class="context-value mono truncate">{{ task.orchestratorSessionId }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── Timeline Tab ─── -->
        <div v-if="activeTab === 'timeline'" class="tab-panel">
          <div class="timeline-stats">
            <div class="timeline-stat">
              <span class="timeline-stat-value">{{ task.attemptCount }}</span>
              <span class="timeline-stat-label">Attempts</span>
            </div>
            <div v-if="duration" class="timeline-stat">
              <span class="timeline-stat-value">{{ duration }}</span>
              <span class="timeline-stat-label">Duration</span>
            </div>
            <div class="timeline-stat">
              <span class="timeline-stat-value">{{ task.maxRetries }}</span>
              <span class="timeline-stat-label">Max Retries</span>
            </div>
          </div>

          <div class="timeline">
            <div
              v-for="(evt, idx) in timelineEvents"
              :key="idx"
              class="timeline-item"
            >
              <div class="timeline-track">
                <span class="timeline-dot" :style="{ color: evt.color }">{{ evt.icon }}</span>
                <div v-if="idx < timelineEvents.length - 1" class="timeline-line" />
              </div>
              <div class="timeline-content">
                <span class="timeline-label">{{ evt.label }}</span>
                <span v-if="evt.time" class="timeline-time">
                  {{ formatDate(evt.time) }}
                  <span class="timeline-relative">{{ relativeTime(evt.time) }}</span>
                </span>
              </div>
            </div>
          </div>

          <div v-if="timelineEvents.length <= 1" class="empty-placeholder">
            No lifecycle events beyond creation.
          </div>
        </div>

        <!-- ─── Raw Tab ─── -->
        <div v-if="activeTab === 'raw'" class="tab-panel">
          <div class="raw-section">
            <div class="raw-header">
              <h3 class="section-heading">Task Record</h3>
              <button
                class="copy-btn"
                @click="copyJson('task', task)"
              >
                {{ copiedSection === 'task' ? '✓ Copied' : 'Copy' }}
              </button>
            </div>
            <div class="json-block-wrapper">
              <pre class="json-block">{{ JSON.stringify(task, null, 2) }}</pre>
            </div>
          </div>

          <div v-if="task.resultParsed" class="raw-section">
            <div class="raw-header">
              <h3 class="section-heading">Result (Parsed)</h3>
              <button
                class="copy-btn"
                @click="copyJson('result', task.resultParsed)"
              >
                {{ copiedSection === 'result' ? '✓ Copied' : 'Copy' }}
              </button>
            </div>
            <div class="json-block-wrapper">
              <pre class="json-block">{{ JSON.stringify(task.resultParsed, null, 2) }}</pre>
            </div>
          </div>

          <div v-if="task.inputParams" class="raw-section">
            <div class="raw-header">
              <h3 class="section-heading">Input Parameters</h3>
              <button
                class="copy-btn"
                @click="copyJson('input', task.inputParams)"
              >
                {{ copiedSection === 'input' ? '✓ Copied' : 'Copy' }}
              </button>
            </div>
            <div class="json-block-wrapper">
              <pre class="json-block">{{ JSON.stringify(task.inputParams, null, 2) }}</pre>
            </div>
          </div>
        </div>
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

/* ─── Loading / Not Found ─── */
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
  margin-bottom: 4px;
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
  margin: 0 0 10px 0;
}

.detail-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.detail-id {
  font-family: "JetBrains Mono", var(--font-mono, monospace);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.detail-sep {
  color: var(--text-placeholder);
  font-size: 0.75rem;
}

.detail-date {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.detail-duration {
  font-size: 0.6875rem;
  color: #34d399;
  font-weight: 500;
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

.btn:hover { color: var(--text-primary); border-color: var(--border-accent); background: var(--neutral-subtle); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--canvas-subtle); color: var(--text-secondary); border-color: var(--border-default); }
.btn-warning { color: #fbbf24; border-color: rgba(251, 191, 36, 0.3); }
.btn-warning:hover { background: rgba(251, 191, 36, 0.1); border-color: rgba(251, 191, 36, 0.5); }
.btn-accent { color: #818cf8; border-color: rgba(129, 140, 248, 0.3); }
.btn-accent:hover { background: rgba(129, 140, 248, 0.1); border-color: rgba(129, 140, 248, 0.5); }
.btn-danger { color: var(--danger-fg, #f87171); border-color: rgba(248, 113, 113, 0.3); }
.btn-danger:hover { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.5); }

/* ─── Tab Bar ─── */
.tab-bar {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border-default);
  margin-bottom: 24px;
  margin-top: 20px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: var(--text-secondary);
}

.tab-btn.active {
  color: var(--accent-fg);
  border-bottom-color: var(--accent-fg);
}

.tab-btn svg {
  opacity: 0.6;
}

.tab-btn.active svg {
  opacity: 1;
}

/* ─── Tab Panels ─── */
.tab-panel {
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ─── Result Tab ─── */
.result-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  text-align: center;
}

.result-empty-icon {
  font-size: 2rem;
  margin-bottom: 4px;
}

.result-empty-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.result-empty-desc {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin: 0;
}

.result-section {
  margin-bottom: 20px;
}

.section-heading {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 10px 0;
}

.result-summary {
  font-size: 0.875rem;
  color: var(--text-primary);
  line-height: 1.6;
  padding: 14px 16px;
  background: rgba(52, 211, 153, 0.06);
  border: 1px solid rgba(52, 211, 153, 0.15);
  border-radius: var(--radius-md);
  white-space: pre-wrap;
}

.meta-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.meta-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 0.6875rem;
}

.meta-chip-label {
  color: var(--text-tertiary);
}

.meta-chip-value {
  color: var(--text-primary);
  font-weight: 500;
}

/* ─── Error Block ─── */
.error-block {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(248, 113, 113, 0.06);
  border: 1px solid rgba(248, 113, 113, 0.15);
  border-radius: var(--radius-md);
}

.error-icon {
  color: #f87171;
  font-weight: 700;
  font-size: 1rem;
  flex-shrink: 0;
  line-height: 1.55;
}

.error-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #f87171;
}

.error-text {
  font-size: 0.8125rem;
  color: #fca5a5;
  line-height: 1.55;
  word-break: break-word;
}

/* ─── Context Tab ─── */
.context-section {
  margin-bottom: 24px;
}

.context-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.context-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.context-row:last-child {
  border-bottom: none;
}

.context-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  min-width: 130px;
  flex-shrink: 0;
}

.context-value {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--text-primary);
  word-break: break-word;
}

/* ─── Timeline Tab ─── */
.timeline-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 28px;
}

.timeline-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.timeline-stat-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.timeline {
  display: flex;
  flex-direction: column;
}

.timeline-item {
  display: flex;
  gap: 14px;
  min-height: 56px;
}

.timeline-track {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}

.timeline-dot {
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1;
  z-index: 1;
}

.timeline-line {
  width: 1px;
  flex: 1;
  background: var(--border-default);
  margin: 4px 0;
}

.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 16px;
}

.timeline-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.timeline-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.timeline-relative {
  color: var(--text-tertiary);
  margin-left: 6px;
}

/* ─── Raw Tab ─── */
.raw-section {
  margin-bottom: 20px;
}

.raw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.copy-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-fg);
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

/* ─── Utility ─── */
.mono {
  font-family: "JetBrains Mono", var(--font-mono, monospace);
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.valid-check {
  color: #34d399;
  font-weight: 500;
}

.invalid-cross {
  color: #f87171;
  font-weight: 500;
}

.empty-placeholder {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
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

  .context-label {
    min-width: 90px;
  }
}
</style>
