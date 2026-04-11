<script setup lang="ts">
import {
  ErrorState,
  formatDate,
  formatDuration,
  formatRelativeTime,
  LoadingSpinner,
  SectionPanel,
  useAutoRefresh,
  useConfirmDialog,
  useToast,
} from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
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
const initialLoading = ref(true);
const cancelling = ref(false);
const retrying = ref(false);

// ─── Auto-refresh ─────────────────────────────────────────────────
const autoRefreshEnabled = ref(true);
const autoRefreshInterval = ref(5);

const { refreshing, refresh } = useAutoRefresh({
  onRefresh: async () => {
    if (taskId.value) await store.refreshTask(taskId.value);
  },
  enabled: autoRefreshEnabled,
  intervalSeconds: autoRefreshInterval,
});

// ─── Tabs ─────────────────────────────────────────────────────────
type TabId = "result" | "context" | "timeline" | "subagent" | "raw";
const activeTab = ref<TabId>("result");
const tabDefs: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "result", label: "Result", icon: "✦" },
  { id: "context", label: "Context", icon: "◎" },
  { id: "timeline", label: "Timeline", icon: "⏱" },
  { id: "subagent", label: "Subagent", icon: "🤖" },
  { id: "raw", label: "Raw", icon: "{ }" },
];

// ─── Computed Helpers ─────────────────────────────────────────────
const canCancel = computed(() => {
  const s = task.value?.status;
  return s === "pending" || s === "claimed" || s === "in_progress";
});

const canRetry = computed(() => {
  const s = task.value?.status;
  return s === "failed" || s === "expired" || s === "dead_letter";
});

const truncatedId = computed(() => {
  const id = task.value?.id;
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
});

const duration = computed(() => {
  const t = task.value;
  if (!t?.completedAt || !t.createdAt) return null;
  const start = new Date(t.createdAt).getTime();
  const end = new Date(t.completedAt).getTime();
  return formatDuration(end - start);
});

const inputEntries = computed(() => {
  const params = task.value?.inputParams;
  if (!params || typeof params !== "object") return [];
  return Object.entries(params);
});

const resultEntries = computed(() => {
  const parsed = task.value?.resultParsed;
  if (!parsed || typeof parsed !== "object") return [];
  return Object.entries(parsed);
});

// ─── Timeline ─────────────────────────────────────────────────────
interface TimelineEvent {
  label: string;
  timestamp: string | null;
  state: "done" | "active" | "pending";
  variant: "default" | "success" | "danger" | "warning";
}

const POST_CLAIMED = new Set([
  "in_progress",
  "done",
  "failed",
  "cancelled",
  "expired",
  "dead_letter",
]);

const timelineEvents = computed<TimelineEvent[]>(() => {
  const t = task.value;
  if (!t) return [];

  const s = t.status;
  const events: TimelineEvent[] = [];

  events.push({
    label: "Created",
    timestamp: t.createdAt,
    state: "done",
    variant: "default",
  });

  if (s === "claimed") {
    events.push({
      label: "Claimed",
      timestamp: t.claimedAt ?? t.updatedAt,
      state: "active",
      variant: "default",
    });
  } else if (POST_CLAIMED.has(s)) {
    events.push({
      label: "Claimed",
      timestamp: t.claimedAt ?? null,
      state: "done",
      variant: "default",
    });
  } else {
    events.push({
      label: "Claimed",
      timestamp: null,
      state: "pending",
      variant: "default",
    });
  }

  if (s === "in_progress") {
    events.push({
      label: "In Progress",
      timestamp: t.startedAt ?? t.updatedAt,
      state: "active",
      variant: "default",
    });
  } else if (s === "done" || s === "failed") {
    events.push({
      label: "In Progress",
      timestamp: t.startedAt ?? null,
      state: "done",
      variant: "default",
    });
  } else {
    events.push({
      label: "In Progress",
      timestamp: null,
      state: "pending",
      variant: "default",
    });
  }

  if (s === "done") {
    events.push({
      label: "Completed",
      timestamp: t.completedAt,
      state: "done",
      variant: "success",
    });
  } else if (s === "failed") {
    events.push({
      label: "Failed",
      timestamp: t.completedAt ?? t.updatedAt,
      state: "done",
      variant: "danger",
    });
  } else if (s === "cancelled") {
    events.push({
      label: "Cancelled",
      timestamp: t.updatedAt,
      state: "done",
      variant: "warning",
    });
  } else if (s === "expired") {
    events.push({
      label: "Expired",
      timestamp: t.updatedAt,
      state: "done",
      variant: "warning",
    });
  } else if (s === "dead_letter") {
    events.push({
      label: "Dead Letter",
      timestamp: t.updatedAt,
      state: "done",
      variant: "danger",
    });
  } else {
    events.push({
      label: "Completed",
      timestamp: null,
      state: "pending",
      variant: "default",
    });
  }

  return events;
});

// ─── Clipboard ────────────────────────────────────────────────────
const copiedSection = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyText(text: string, section: string) {
  try {
    await navigator.clipboard.writeText(text);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedSection.value = section;
    copiedTimer = setTimeout(() => {
      copiedSection.value = null;
    }, 2000);
  } catch {
    toast.error("Failed to copy to clipboard");
  }
}

// ─── Display Helpers ──────────────────────────────────────────────
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function isSimpleValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

// ─── Actions ──────────────────────────────────────────────────────
async function loadTask(id: string) {
  await store.getTask(id);
  initialLoading.value = false;
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
    message:
      "Are you sure you want to permanently delete this task?" + " This action cannot be undone.",
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
        <RefreshToolbar
          :refreshing="refreshing"
          :auto-refresh-enabled="autoRefreshEnabled"
          :interval-seconds="autoRefreshInterval"
          @refresh="refresh"
          @update:auto-refresh-enabled="autoRefreshEnabled = $event"
          @update:interval-seconds="autoRefreshInterval = $event"
        />
      </div>

      <!-- Loading -->
      <div v-if="initialLoading" class="loading-state">
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
      <div v-else-if="!task && !initialLoading" class="not-found">
        <p>Task "{{ taskId }}" was not found.</p>
        <button class="btn btn-secondary" @click="goBack">
          Back to Tasks
        </button>
      </div>

      <!-- ═══════════════ Task Detail ═══════════════ -->
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
            <div class="detail-meta">
              <button
                class="meta-chip meta-chip-id"
                :title="`Copy ID: ${task.id}`"
                @click="copyText(task.id, 'id')"
              >
                {{ copiedSection === "id" ? "Copied ✓" : `ID: ${truncatedId}` }}
              </button>
              <span class="meta-chip">
                {{ formatDate(task.createdAt) }}
              </span>
              <span v-if="duration" class="meta-chip meta-chip-accent">
                ⏱ {{ duration }}
              </span>
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

        <!-- Error banner (persistent across tabs) -->
        <div v-if="task.errorMessage" class="error-banner">
          <span class="error-banner-icon">✗</span>
          <span class="error-banner-text">{{ task.errorMessage }}</span>
        </div>

        <!-- Tab bar -->
        <nav class="tab-bar" role="tablist" aria-label="Task detail tabs">
          <button
            v-for="tab in tabDefs"
            :key="tab.id"
            role="tab"
            :aria-selected="activeTab === tab.id"
            class="tab-item"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        </nav>

        <!-- ─── Tab Panels ─── -->
        <div class="tab-panel">
          <!-- ═══ Result ═══ -->
          <div v-if="activeTab === 'result'" class="panel-content">
            <div v-if="task.resultSummary" class="result-card">
              <div class="card-label">Summary</div>
              <div class="result-summary-text">
                {{ task.resultSummary }}
              </div>
            </div>

            <div v-if="resultEntries.length > 0" class="result-card">
              <div class="card-label">Parsed Result</div>
              <div class="kv-table">
                <div
                  v-for="[key, val] in resultEntries"
                  :key="key"
                  class="kv-row"
                >
                  <span class="kv-key">{{ key }}</span>
                  <span v-if="isSimpleValue(val)" class="kv-val">
                    {{ formatValue(val) }}
                  </span>
                  <pre v-else class="kv-val-block">{{ formatValue(val) }}</pre>
                </div>
              </div>
            </div>

            <div
              v-if="task.schemaValid != null && task.status === 'done'"
              class="schema-badge-row"
            >
              <span :class="task.schemaValid ? 'schema-pass' : 'schema-fail'">
                {{ task.schemaValid ? "✓ Schema Valid" : "✗ Schema Invalid" }}
              </span>
            </div>

            <!-- Empty: pending / in_progress -->
            <div
              v-if="
                !task.resultSummary &&
                resultEntries.length === 0 &&
                task.status !== 'done' &&
                task.status !== 'failed'
              "
              class="empty-state"
            >
              <div class="empty-icon">✦</div>
              <div class="empty-heading">No results yet</div>
              <div class="empty-desc">
                This task is
                {{ task.status === "in_progress" ? "currently running" : "waiting to be processed" }}.
                Results will appear here once complete.
              </div>
            </div>

            <!-- Empty: done with no data -->
            <div
              v-if="
                !task.resultSummary &&
                resultEntries.length === 0 &&
                task.status === 'done'
              "
              class="empty-state"
            >
              <div class="empty-icon">○</div>
              <div class="empty-heading">No result data</div>
              <div class="empty-desc">
                The task completed but did not produce result data.
              </div>
            </div>

            <!-- Empty: failed -->
            <div
              v-if="
                !task.resultSummary &&
                resultEntries.length === 0 &&
                task.status === 'failed'
              "
              class="empty-state"
            >
              <div class="empty-icon empty-icon-danger">✗</div>
              <div class="empty-heading">Task failed</div>
              <div class="empty-desc">
                See the error banner above for details.
              </div>
            </div>
          </div>

          <!-- ═══ Context ═══ -->
          <div v-if="activeTab === 'context'" class="panel-content">
            <SectionPanel title="Input Parameters">
              <div v-if="inputEntries.length > 0" class="kv-table">
                <div
                  v-for="[key, val] in inputEntries"
                  :key="key"
                  class="kv-row"
                >
                  <span class="kv-key">{{ key }}</span>
                  <span v-if="isSimpleValue(val)" class="kv-val">
                    {{ formatValue(val) }}
                  </span>
                  <pre v-else class="kv-val-block">{{ formatValue(val) }}</pre>
                </div>
              </div>
              <div v-else class="empty-placeholder">No input parameters.</div>
            </SectionPanel>

            <SectionPanel title="Preset">
              <div class="kv-table">
                <div class="kv-row">
                  <span class="kv-key">Preset ID</span>
                  <span class="kv-val mono">{{ task.presetId }}</span>
                </div>
                <div class="kv-row">
                  <span class="kv-key">Task Type</span>
                  <span class="kv-val">
                    <TaskTypeBadge :task-type="task.taskType" />
                  </span>
                </div>
                <div class="kv-row">
                  <span class="kv-key">Priority</span>
                  <span class="kv-val">
                    <PriorityBadge :priority="task.priority" />
                  </span>
                </div>
                <div class="kv-row">
                  <span class="kv-key">Max Retries</span>
                  <span class="kv-val mono">{{ task.maxRetries }}</span>
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="Context Source">
              <div
                v-if="task.contextHash || task.orchestratorSessionId || task.jobId"
                class="kv-table"
              >
                <div v-if="task.contextHash" class="kv-row">
                  <span class="kv-key">Context Hash</span>
                  <span class="kv-val mono truncate">
                    {{ task.contextHash }}
                  </span>
                </div>
                <div v-if="task.orchestratorSessionId" class="kv-row">
                  <span class="kv-key">Session</span>
                  <span class="kv-val mono truncate">
                    {{ task.orchestratorSessionId }}
                  </span>
                </div>
                <div v-if="task.jobId" class="kv-row">
                  <span class="kv-key">Job ID</span>
                  <span class="kv-val mono">{{ task.jobId }}</span>
                </div>
              </div>
              <div v-else class="empty-placeholder">
                No context source information available.
              </div>
            </SectionPanel>
          </div>

          <!-- ═══ Timeline ═══ -->
          <div v-if="activeTab === 'timeline'" class="panel-content">
            <div class="timeline">
              <div
                v-for="(evt, idx) in timelineEvents"
                :key="idx"
                class="tl-item"
                :class="[`tl-${evt.state}`, `tl-v-${evt.variant}`]"
              >
                <div class="tl-rail">
                  <div class="tl-dot" />
                  <div v-if="idx < timelineEvents.length - 1" class="tl-line" />
                </div>
                <div class="tl-body">
                  <div class="tl-label">{{ evt.label }}</div>
                  <div v-if="evt.timestamp" class="tl-time">
                    {{ formatDate(evt.timestamp) }}
                    <span class="tl-relative">
                      · {{ formatRelativeTime(evt.timestamp) }}
                    </span>
                  </div>
                  <div
                    v-else-if="evt.state === 'active'"
                    class="tl-time tl-active-text"
                  >
                    In progress…
                  </div>
                  <div
                    v-else-if="evt.state === 'pending'"
                    class="tl-time tl-pending-text"
                  >
                    Waiting
                  </div>
                </div>
              </div>
            </div>

            <div class="tl-summary-grid">
              <div v-if="duration" class="tl-summary-item">
                <span class="tl-summary-label">Total Duration</span>
                <span class="tl-summary-value">{{ duration }}</span>
              </div>
              <div
                v-if="task.attemptCount > 1 || task.maxRetries > 1"
                class="tl-summary-item"
              >
                <span class="tl-summary-label">Attempts</span>
                <span class="tl-summary-value">
                  {{ task.attemptCount }} / {{ task.maxRetries }}
                </span>
              </div>
              <div class="tl-summary-item">
                <span class="tl-summary-label">Last Updated</span>
                <span class="tl-summary-value">
                  {{ formatRelativeTime(task.updatedAt) }}
                </span>
              </div>
            </div>
          </div>

          <!-- ═══ Subagent ═══ -->
          <div v-if="activeTab === 'subagent'" class="panel-content">
            <template v-if="task.orchestratorSessionId">
              <SectionPanel title="Orchestrator Attribution">
                <div class="kv-table">
                  <div class="kv-row">
                    <span class="kv-key">Session ID</span>
                    <span class="kv-val mono truncate">
                      {{ task.orchestratorSessionId }}
                    </span>
                  </div>
                  <div class="kv-row">
                    <span class="kv-key">Task Status</span>
                    <span class="kv-val">
                      <TaskStatusBadge :status="task.status" />
                    </span>
                  </div>
                  <div v-if="task.jobId" class="kv-row">
                    <span class="kv-key">Job ID</span>
                    <span class="kv-val mono">{{ task.jobId }}</span>
                  </div>
                  <div v-if="task.schemaValid != null" class="kv-row">
                    <span class="kv-key">Schema Valid</span>
                    <span class="kv-val">
                      <span
                        :class="task.schemaValid ? 'valid-check' : 'invalid-cross'"
                      >
                        {{ task.schemaValid ? "✓ Yes" : "✗ No" }}
                      </span>
                    </span>
                  </div>
                </div>
              </SectionPanel>
            </template>

            <div v-else class="empty-state">
              <div class="empty-icon">🤖</div>
              <div class="empty-heading">No subagent data</div>
              <div class="empty-desc">
                This task does not have orchestrator or subagent attribution
                information.
              </div>
            </div>
          </div>

          <!-- ═══ Raw ═══ -->
          <div v-if="activeTab === 'raw'" class="panel-content">
            <SectionPanel title="Task Object">
              <template #actions>
                <button
                  class="copy-btn"
                  @click="copyText(JSON.stringify(task, null, 2), 'raw-task')"
                >
                  {{ copiedSection === "raw-task" ? "Copied ✓" : "Copy" }}
                </button>
              </template>
              <div class="json-block-wrapper">
                <pre class="json-block">{{ JSON.stringify(task, null, 2) }}</pre>
              </div>
            </SectionPanel>

            <SectionPanel v-if="task.resultParsed" title="Result Parsed">
              <template #actions>
                <button
                  class="copy-btn"
                  @click="
                    copyText(
                      JSON.stringify(task.resultParsed, null, 2),
                      'raw-result',
                    )
                  "
                >
                  {{ copiedSection === "raw-result" ? "Copied ✓" : "Copy" }}
                </button>
              </template>
              <div class="json-block-wrapper">
                <pre class="json-block">{{
                  JSON.stringify(task.resultParsed, null, 2)
                }}</pre>
              </div>
            </SectionPanel>

            <SectionPanel title="Input Parameters">
              <template #actions>
                <button
                  class="copy-btn"
                  @click="
                    copyText(
                      JSON.stringify(task.inputParams, null, 2),
                      'raw-input',
                    )
                  "
                >
                  {{ copiedSection === "raw-input" ? "Copied ✓" : "Copy" }}
                </button>
              </template>
              <div class="json-block-wrapper">
                <pre class="json-block">{{
                  JSON.stringify(task.inputParams, null, 2)
                }}</pre>
              </div>
            </SectionPanel>
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
  margin-bottom: 16px;
  flex-wrap: wrap;
  overflow: hidden;
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
  margin-bottom: 10px;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-md);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.meta-chip-id {
  cursor: pointer;
  font-family: "JetBrains Mono", var(--font-mono, monospace);
  transition: all var(--transition-fast);
}

.meta-chip-id:hover {
  color: var(--text-secondary);
  border-color: var(--border-default);
  background: var(--neutral-subtle);
}

.meta-chip-accent {
  color: var(--accent-fg);
  border-color: var(--accent-muted);
  background: var(--accent-subtle);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ─── Error Banner ─── */
.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-subtle);
  border-radius: var(--radius-lg);
}

.error-banner-icon {
  color: var(--danger-fg);
  font-weight: 700;
  font-size: 0.875rem;
  flex-shrink: 0;
  line-height: 1.55;
}

.error-banner-text {
  font-size: 0.8125rem;
  color: var(--danger-fg);
  line-height: 1.55;
  word-break: break-word;
}

/* ─── Tab Bar ─── */
.tab-bar {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border-default);
  margin-bottom: 20px;
  overflow-x: auto;
}

.tab-item {
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
  white-space: nowrap;
  margin-bottom: -1px;
}

.tab-item:hover {
  color: var(--text-secondary);
  background: var(--neutral-subtle);
}

.tab-item.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-fg);
}

.tab-icon {
  font-size: 0.75rem;
  opacity: 0.7;
}

.tab-item.active .tab-icon {
  opacity: 1;
}

/* ─── Tab Panel ─── */
.tab-panel {
  min-height: 200px;
}

.panel-content {
  animation: panel-in 0.15s ease-out;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
  color: var(--warning-fg);
  border-color: var(--warning-muted);
}

.btn-warning:hover {
  background: var(--warning-subtle);
  border-color: var(--warning-muted);
}

.btn-accent {
  color: var(--accent-fg);
  border-color: var(--accent-muted);
}

.btn-accent:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-muted);
}

.btn-danger {
  color: var(--danger-fg);
  border-color: var(--danger-muted);
}

.btn-danger:hover {
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
}

/* ─── Copy Button ─── */
.copy-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.copy-btn:hover {
  color: var(--text-secondary);
  border-color: var(--border-default);
}

/* ─── Key-Value Table ─── */
.kv-table {
  display: flex;
  flex-direction: column;
}

.kv-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.kv-row:last-child {
  border-bottom: none;
}

.kv-key {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  min-width: 140px;
  flex-shrink: 0;
}

.kv-val {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--text-primary);
  word-break: break-word;
}

.kv-val-block {
  flex: 1;
  min-width: 0;
  font-family: "JetBrains Mono", var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin: 4px 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  max-height: 200px;
}

.mono {
  font-family: "JetBrains Mono", var(--font-mono, monospace);
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.valid-check {
  color: var(--success-fg);
  font-weight: 500;
}

.invalid-cross {
  color: var(--danger-fg);
  font-weight: 500;
}

/* ─── Result Card ─── */
.result-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  margin-bottom: 16px;
}

.card-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}

.result-summary-text {
  font-size: 0.875rem;
  color: var(--text-primary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.schema-badge-row {
  margin-top: 4px;
  margin-bottom: 16px;
}

.schema-pass {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--success-fg);
  background: var(--success-subtle);
  border: 1px solid var(--success-subtle);
}

.schema-fail {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--danger-fg);
  background: var(--danger-subtle);
  border: 1px solid var(--danger-subtle);
}

/* ─── Empty State ─── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 1.75rem;
  opacity: 0.4;
  margin-bottom: 4px;
}

.empty-icon-danger {
  color: var(--danger-fg);
  opacity: 0.6;
}

.empty-heading {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty-desc {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  max-width: 320px;
  line-height: 1.5;
}

.empty-placeholder {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
}

/* ─── JSON Block ─── */
.json-block-wrapper {
  overflow: auto;
  max-height: 400px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--canvas-inset);
}

.json-block {
  font-family: "JetBrains Mono", var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary);
  padding: 16px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ─── Timeline ─── */
.timeline {
  padding: 8px 0 24px;
}

.tl-item {
  display: flex;
  gap: 16px;
  min-height: 56px;
}

.tl-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}

.tl-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--border-default);
  background: var(--canvas-default);
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.tl-done .tl-dot {
  border-color: var(--text-secondary);
  background: var(--text-secondary);
}

.tl-active .tl-dot {
  border-color: var(--accent-fg);
  background: var(--accent-fg);
  box-shadow: 0 0 0 3px var(--accent-muted);
  animation: tl-pulse 1.5s ease-in-out infinite;
}

.tl-pending .tl-dot {
  border-color: var(--border-subtle);
  background: transparent;
}

/* Terminal variant overrides */
.tl-v-success.tl-done .tl-dot {
  border-color: var(--success-fg);
  background: var(--success-fg);
}

.tl-v-danger.tl-done .tl-dot {
  border-color: var(--danger-fg);
  background: var(--danger-fg);
}

.tl-v-warning.tl-done .tl-dot {
  border-color: var(--warning-fg);
  background: var(--warning-fg);
}

@keyframes tl-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px var(--accent-muted);
  }
  50% {
    box-shadow: 0 0 0 6px var(--accent-subtle);
  }
}

.tl-line {
  flex: 1;
  width: 2px;
  background: var(--border-default);
  min-height: 20px;
}

.tl-pending .tl-line {
  background: var(--border-subtle);
  opacity: 0.5;
}

.tl-body {
  padding-bottom: 16px;
}

.tl-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
  margin-bottom: 2px;
}

.tl-pending .tl-label {
  color: var(--text-tertiary);
}

.tl-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.tl-relative {
  color: var(--text-tertiary);
}

.tl-active-text {
  color: var(--accent-fg);
  font-weight: 500;
}

.tl-pending-text {
  color: var(--text-tertiary);
  font-style: italic;
}

.tl-summary-grid {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.tl-summary-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  min-width: 120px;
}

.tl-summary-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.tl-summary-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
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

  .kv-key {
    min-width: 100px;
  }

  .tl-summary-grid {
    flex-direction: column;
  }
}
</style>