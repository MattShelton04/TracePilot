<script setup lang="ts">
import { ErrorState, LoadingSpinner, PageShell, TabNav } from "@tracepilot/ui";
import { computed, ref } from "vue";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import TaskContextPanel from "@/components/tasks/detail/TaskContextPanel.vue";
import TaskDetailHeader from "@/components/tasks/detail/TaskDetailHeader.vue";
import TaskRawPanel from "@/components/tasks/detail/TaskRawPanel.vue";
import TaskResultPanel from "@/components/tasks/detail/TaskResultPanel.vue";
import TaskSubagentPanel from "@/components/tasks/detail/TaskSubagentPanel.vue";
import TaskTimelinePanel from "@/components/tasks/detail/TaskTimelinePanel.vue";
import { type TaskDetailTabId, useTaskDetail } from "@/composables/useTaskDetail";
import "@/styles/features/task-detail.css";

const {
  store,
  taskId,
  task,
  initialLoading,
  cancelling,
  retrying,
  autoRefreshEnabled,
  autoRefreshInterval,
  refreshing,
  refresh,
  canCancel,
  canRetry,
  truncatedId,
  duration,
  inputEntries,
  resultEntries,
  timelineEvents,
  copiedSection,
  copyText,
  loadTask,
  handleCancel,
  handleRetry,
  handleDelete,
  goBack,
} = useTaskDetail();

const activeTab = ref<TaskDetailTabId>("result");
const tabDefs: Array<{ id: TaskDetailTabId; label: string; icon: string }> = [
  { id: "result", label: "Result", icon: "✦" },
  { id: "context", label: "Context", icon: "◎" },
  { id: "timeline", label: "Timeline", icon: "⏱" },
  { id: "subagent", label: "Subagent", icon: "🤖" },
  { id: "raw", label: "Raw", icon: "{ }" },
];

const tabNavItems = computed(() =>
  tabDefs.map((t) => ({
    name: t.id,
    routeName: t.id,
    label: t.label,
    icon: t.icon,
  })),
);
</script>

<template>
  <PageShell class="task-detail-feature">
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

    <div v-if="initialLoading" class="loading-state">
      <LoadingSpinner size="lg" />
      <span class="loading-label">Loading task…</span>
    </div>

    <ErrorState
      v-else-if="!task && store.error"
      heading="Failed to load task"
      :message="store.error"
      @retry="loadTask(taskId)"
    />

    <div v-else-if="!task && !initialLoading" class="not-found">
      <p>Task "{{ taskId }}" was not found.</p>
      <button class="btn btn-secondary" @click="goBack">
        Back to Tasks
      </button>
    </div>

    <template v-if="task">
      <TaskDetailHeader
        :task="task"
        :truncated-id="truncatedId"
        :duration="duration"
        :can-cancel="canCancel"
        :can-retry="canRetry"
        :cancelling="cancelling"
        :retrying="retrying"
        :copied-section="copiedSection"
        @cancel="handleCancel"
        @retry="handleRetry"
        @delete="handleDelete"
        @copy="copyText"
      />

      <div v-if="task.errorMessage" class="error-banner">
        <span class="error-banner-icon">✗</span>
        <span class="error-banner-text">{{ task.errorMessage }}</span>
      </div>

      <TabNav
        :tabs="tabNavItems"
        :model-value="activeTab"
        staggered
        class="task-detail-tabs"
        @update:model-value="(v) => (activeTab = v as TaskDetailTabId)"
      />

      <div class="tab-panel">
        <TaskResultPanel
          v-if="activeTab === 'result'"
          :task="task"
          :result-entries="resultEntries"
        />
        <TaskContextPanel
          v-else-if="activeTab === 'context'"
          :task="task"
          :input-entries="inputEntries"
        />
        <TaskTimelinePanel
          v-else-if="activeTab === 'timeline'"
          :task="task"
          :timeline-events="timelineEvents"
          :duration="duration"
        />
        <TaskSubagentPanel
          v-else-if="activeTab === 'subagent'"
          :task="task"
        />
        <TaskRawPanel
          v-else-if="activeTab === 'raw'"
          :task="task"
          :copied-section="copiedSection"
          @copy="copyText"
        />
      </div>
    </template>
  </PageShell>
</template>
