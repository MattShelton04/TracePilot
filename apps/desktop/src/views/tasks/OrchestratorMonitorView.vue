<script setup lang="ts">
import { ErrorState, LoadingSpinner, PageShell } from "@tracepilot/ui";
import ActiveSubagentsPanel from "@/components/tasks/monitor/ActiveSubagentsPanel.vue";
import ActiveTasksPanel from "@/components/tasks/monitor/ActiveTasksPanel.vue";
import CompletedSubagentsPanel from "@/components/tasks/monitor/CompletedSubagentsPanel.vue";
import OrchestratorActivityFeed from "@/components/tasks/monitor/OrchestratorActivityFeed.vue";
import OrchestratorHeaderBar from "@/components/tasks/monitor/OrchestratorHeaderBar.vue";
import OrchestratorHealthPanel from "@/components/tasks/monitor/OrchestratorHealthPanel.vue";
import OrchestratorStatsGrid from "@/components/tasks/monitor/OrchestratorStatsGrid.vue";
import OrchestratorStatusHero from "@/components/tasks/monitor/OrchestratorStatusHero.vue";
import { useOrchestratorMonitor } from "@/composables/useOrchestratorMonitor";
import "@/styles/features/orchestrator-monitor.css";

const {
  orchestrator,
  healthExpanded,
  autoRefreshEnabled,
  autoRefreshInterval,
  refreshing,
  autoRefresh,
  stateLabel,
  stateColorClass,
  heartbeatDisplay,
  heartbeatColor,
  activeTaskCount,
  lastCycle,
  ringDasharray,
  uptimeDisplay,
  subagentLabel,
  resolveTask,
  subagentStartTime,
  truncateId,
  truncateError,
  elapsedSince,
  durationBetween,
  formatActivityTime,
  viewSession,
  viewTask,
  showModelPicker,
  selectedModelName,
  selectedModelTier,
  modelTiers,
  modelDropdownStyle,
  selectModel,
} = useOrchestratorMonitor();
</script>

<template>
  <PageShell class="orchestrator-monitor-feature">
    <OrchestratorHeaderBar
      :is-stopped="orchestrator.isStopped"
      :starting="orchestrator.starting"
      :stopping="orchestrator.stopping"
      :has-models="orchestrator.models.length > 0"
      :selected-model="orchestrator.selectedModel"
      :selected-model-name="selectedModelName"
      :selected-model-tier="selectedModelTier"
      :model-tiers="modelTiers"
      :show-model-picker="showModelPicker"
      :model-dropdown-style="modelDropdownStyle"
      :refreshing="refreshing"
      :auto-refresh-enabled="autoRefreshEnabled"
      :auto-refresh-interval="autoRefreshInterval"
      @toggle-model-picker="showModelPicker = !showModelPicker"
      @close-model-picker="showModelPicker = false"
      @select-model="selectModel"
      @start="orchestrator.startOrchestrator()"
      @stop="orchestrator.stopOrchestrator()"
      @refresh="autoRefresh"
      @update:auto-refresh-enabled="autoRefreshEnabled = $event"
      @update:auto-refresh-interval="autoRefreshInterval = $event"
    />

    <ErrorState
      v-if="orchestrator.error && !orchestrator.health"
      heading="Health check failed"
      :message="orchestrator.error"
      @retry="orchestrator.refresh()"
    />

    <div v-else-if="orchestrator.loading && !orchestrator.health" class="loading-container">
      <LoadingSpinner />
      <span class="loading-text">Checking orchestrator health…</span>
    </div>

    <template v-else>
      <OrchestratorStatusHero
        :state-label="stateLabel"
        :state-color-class="stateColorClass"
        :heartbeat-display="heartbeatDisplay"
        :ring-dasharray="ringDasharray"
        :is-running="orchestrator.isRunning"
        :pid="orchestrator.handle?.pid"
        :uptime-display="uptimeDisplay"
        :session-uuid="orchestrator.sessionUuid"
        :needs-restart="orchestrator.needsRestart"
        :error="orchestrator.error"
        @view-session="viewSession"
      />

      <OrchestratorStatsGrid
        :heartbeat-age-secs="orchestrator.health?.heartbeatAgeSecs"
        :heartbeat-color="heartbeatColor"
        :last-cycle="lastCycle"
        :active-task-count="activeTaskCount"
        :last-ingested-count="orchestrator.lastIngestedCount"
      />

      <ActiveTasksPanel
        :active-task-ids="orchestrator.health?.activeTasks ?? []"
        :active-task-count="activeTaskCount"
        :has-health="!!orchestrator.health"
        :is-running="orchestrator.isRunning"
        :subagent-label="subagentLabel"
        :resolve-task="resolveTask"
        :subagent-start-time="subagentStartTime"
        :truncate-id="truncateId"
        :elapsed-since="elapsedSince"
        @view-task="viewTask"
      />

      <ActiveSubagentsPanel
        :agents="orchestrator.activeSubagents"
        :session-uuid="orchestrator.sessionUuid"
        :subagent-label="subagentLabel"
        :truncate-id="truncateId"
        :elapsed-since="elapsedSince"
        @view-task="viewTask"
      />

      <CompletedSubagentsPanel
        :agents="orchestrator.completedSubagents"
        :subagent-label="subagentLabel"
        :truncate-id="truncateId"
        :truncate-error="truncateError"
        :duration-between="durationBetween"
        @view-task="viewTask"
      />

      <OrchestratorActivityFeed
        :entries="orchestrator.activityFeed"
        :is-running="orchestrator.isRunning"
        :format-activity-time="formatActivityTime"
      />

      <OrchestratorHealthPanel
        :health-expanded="healthExpanded"
        :health-status="orchestrator.health?.health"
        :needs-restart="orchestrator.needsRestart"
        :error="orchestrator.error"
        :truncate-error="truncateError"
        @toggle="healthExpanded = !healthExpanded"
      />
    </template>
  </PageShell>
</template>
