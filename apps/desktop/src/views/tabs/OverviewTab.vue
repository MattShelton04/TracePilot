<script setup lang="ts">
import {
  Badge,
  DefList,
  ErrorAlert,
  formatAiCredits,
  formatDate,
  formatNumberFull,
  formatTime,
  MarkdownContent,
  SectionPanel,
  StatCard,
  truncateText,
  useClipboard,
  useSessionTabLoader,
} from "@tracepilot/ui";
import { Check, Copy } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import CheckpointTimeline from "@/components/checkpoints/CheckpointTimeline.vue";
import FileHistoryPanel from "@/components/checkpoints/FileHistoryPanel.vue";
import BackgroundTasksPanel from "@/components/session/BackgroundTasksPanel.vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { allowsAiCreditEstimate } from "@/composables/useSessionMetrics";
import { useSessionSource } from "@/composables/useSessionSource";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { formatObjectResult } from "@/utils/formatResult";
import { formatRecordedDuration } from "@/utils/sessionDurations";
import { effortLabel, sessionEffort, sessionModel } from "@/utils/sessionModel";
import { API_EQUIVALENT_NOTE, formatSessionCost, sessionCostEstimate } from "@/utils/sourceCost";

const store = useSessionDetailContext();

useSessionTabLoader(
  () => store.sessionId,
  () => {
    store.loadCheckpoints();
    store.loadPlan();
    store.loadShutdownMetrics();
    store.loadIncidents();
  },
);

const detail = computed(() => store.detail);
const currentModel = computed(() => sessionModel(detail.value));
const currentEffort = computed(() => sessionEffort(detail.value));
const metrics = computed(() => store.shutdownMetrics);
const incidents = computed(() => store.incidents);
const prefs = usePreferencesStore();
const { source, capabilities } = useSessionSource(
  () => store.sessionId,
  () => store.detail,
);
const sessions = useSessionsStore();
const sessionLive = computed(
  () => sessions.sessions.find((s) => s.id === store.sessionId)?.isRunning ?? false,
);
// Only sources that record background work or back up files are asked for them.
watch(
  () => (capabilities.value.hasBackgroundTasks ? store.sessionId : null),
  (id) => {
    if (id) store.loadBackgroundTasks();
  },
  { immediate: true },
);
watch(
  () => (capabilities.value.hasFileHistory ? store.sessionId : null),
  (id) => {
    if (id) store.loadFileHistory();
  },
  { immediate: true },
);
const sourceCost = computed(() =>
  capabilities.value.hasAic ? null : sessionCostEstimate(source.value, metrics.value),
);
// Copilot always reports its host; other sources show it only when recorded.
const showHost = computed(() => source.value === "copilot" || detail.value?.hostType != null);
const { aiCreditUsage } = useMetricsTabData(
  metrics,
  prefs,
  () => !allowsAiCreditEstimate(source.value),
);

const cwd = computed(() => detail.value?.cwd?.trim() || null);
// Split before the last segment so the middle of a long path truncates first.
const cwdParts = computed(() => {
  const path = cwd.value ?? "";
  const match = /^(.*[\\/])([^\\/]+[\\/]*)$/.exec(path);
  return match ? { head: match[1], tail: match[2] } : { head: "", tail: path };
});
const { copy: copyText, copied: cwdCopied } = useClipboard();

const sessionInfoItems = computed(() => {
  const d = detail.value;
  return [
    { label: "Session ID", value: d?.id ?? "—" },
    { label: "Repository", value: d?.repository ?? "—" },
    { label: "Branch", value: d?.branch ?? "—" },
    ...(cwd.value ? [{ label: "Working directory", value: cwd.value, slot: "cwd" }] : []),
    { label: "Model", value: currentModel.value ?? "—" },
    { label: "Reasoning effort", value: currentEffort.value ?? "Model default" },
    ...(showHost.value ? [{ label: "Host", value: d?.hostType ?? "—" }] : []),
    { label: "API Time", value: formatRecordedDuration(metrics.value?.totalApiDurationMs) },
    { label: "Created", value: formatDate(d?.createdAt) },
    { label: "Updated", value: formatDate(d?.updatedAt) },
  ];
});

const summaryText = computed(() => detail.value?.summary);

const expandedIncidents = ref<Set<number>>(new Set());

function toggleExpand(idx: number) {
  if (expandedIncidents.value.has(idx)) {
    expandedIncidents.value.delete(idx);
  } else {
    expandedIncidents.value.add(idx);
  }
}

function isLongSummary(summary: string): boolean {
  return summary.length > 80;
}

function incidentSeverityVariant(severity: string): "danger" | "warning" | "neutral" {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

function incidentTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    error: "Error",
    warning: "Warning",
    compaction: "Compaction",
    truncation: "Truncation",
  };
  return labels[eventType] ?? eventType;
}

const expandedDetails = ref<Set<number>>(new Set());

function toggleDetail(idx: number) {
  if (expandedDetails.value.has(idx)) {
    expandedDetails.value.delete(idx);
  } else {
    expandedDetails.value.add(idx);
  }
}

const isPlanExpanded = ref(true);
const timelineRef = ref<InstanceType<typeof CheckpointTimeline> | null>(null);

function hasDetail(incident: { detailJson?: unknown }): boolean {
  return incident.detailJson != null && incident.detailJson !== "";
}

function retryLoadSection(section: string) {
  store.loaded.delete(section);
  switch (section) {
    case "checkpoints":
      store.loadCheckpoints();
      break;
    case "plan":
      store.loadPlan();
      break;
    case "backgroundTasks":
      store.loadBackgroundTasks();
      break;
    case "fileHistory":
      store.loadFileHistory();
      break;
    case "metrics":
      store.loadShutdownMetrics();
      break;
    case "incidents":
      store.loadIncidents();
      break;
  }
}
</script>

<template>
  <div>
    <!-- Section load errors -->
    <ErrorAlert
      v-if="store.checkpointsError"
      :message="`Checkpoints: ${store.checkpointsError}`"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadSection('checkpoints')"
    />
    <ErrorAlert
      v-if="store.planError"
      :message="`Plan: ${store.planError}`"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadSection('plan')"
    />
    <ErrorAlert
      v-if="store.backgroundTasksError"
      :message="`Background tasks: ${store.backgroundTasksError}`"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadSection('backgroundTasks')"
    />
    <ErrorAlert
      v-if="store.fileHistoryError"
      :message="`Checkpoints: ${store.fileHistoryError}`"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadSection('fileHistory')"
    />
    <ErrorAlert
      v-if="store.metricsError"
      :message="`Metrics: ${store.metricsError}`"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadSection('metrics')"
    />
    <ErrorAlert
      v-if="store.incidentsError"
      :message="`Incidents: ${store.incidentsError}`"
      severity="warning"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadSection('incidents')"
    />

    <!-- Stats row -->
    <div class="grid-4 mb-6">
      <StatCard :value="detail?.eventCount ?? 0" label="Events" :gradient="true" />
      <StatCard :value="detail?.turnCount ?? 0" label="Turns" :gradient="true" />
      <StatCard v-if="capabilities.hasCheckpoints" :value="detail?.checkpointCount ?? 0" label="Checkpoints" color="success" />
      <StatCard
        v-else
        :value="metrics?.coverage?.recordedCalls ?? '—'"
        label="Recorded Requests"
        color="success"
        tooltip="Model calls recorded in the transcript"
      />
      <StatCard
        v-if="sourceCost"
        :value="formatSessionCost(sourceCost)"
        label="Est. Cost (USD)"
        color="done"
        :trend="sourceCost.partial ? `${sourceCost.basisLabel} · partial` : sourceCost.basisLabel"
        :tooltip="`${sourceCost.coverage} ${API_EQUIVALENT_NOTE}`"
      />
      <StatCard
        v-else
        :value="formatAiCredits(aiCreditUsage.credits)"
        label="AI Credits"
        color="done"
        :tooltip="aiCreditUsage.source === 'observed' ? 'Observed Copilot billing telemetry' : 'Estimated for historical session data'"
      />
    </div>

    <!-- Two-column layout -->
    <div class="grid-2 mb-6">
      <!-- Session Info -->
      <SectionPanel title="Session Info">
        <DefList :items="sessionInfoItems">
          <template #cwd>
            <span class="cwd-value">
              <span class="cwd-path" :title="cwd ?? undefined" data-testid="session-cwd">
                <span class="cwd-path__head">{{ cwdParts.head }}</span>
                <span class="cwd-path__tail">{{ cwdParts.tail }}</span>
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-sm cwd-copy"
                :title="cwdCopied ? 'Copied' : 'Copy working directory'"
                :aria-label="cwdCopied ? 'Copied' : 'Copy working directory'"
                data-testid="session-cwd-copy"
                @click="cwd && copyText(cwd)"
              >
                <Check v-if="cwdCopied" :size="12" aria-hidden="true" />
                <Copy v-else :size="12" aria-hidden="true" />
              </button>
            </span>
          </template>
        </DefList>
      </SectionPanel>

      <!-- Session Summary -->
      <SectionPanel title="Session Summary">
        <p v-if="summaryText" class="summary-prose">{{ summaryText }}</p>
        <p v-else class="summary-prose summary-prose--empty">No summary available.</p>
        <dl class="def-list def-list--spaced">
          <dt>API Time</dt>
          <dd>{{ formatRecordedDuration(metrics?.totalApiDurationMs) }}</dd>
          <dt>Current Model</dt>
          <dd class="flex flex-wrap items-center gap-1">
            <Badge v-if="currentModel" variant="done">{{ currentModel }}</Badge>
            <span v-else>—</span>
            <Badge v-if="currentEffort" variant="neutral">{{ effortLabel(currentEffort) }}</Badge>
          </dd>
          <template v-if="source === 'copilot'">
            <dt>Shutdown Type</dt>
            <dd>{{ metrics?.shutdownType ?? "—" }}</dd>
          </template>
          <template v-if="metrics?.codeChanges">
            <dt>Code Changes</dt>
            <dd>
              <span class="lines-added">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
              <span class="lines-sep"> / </span>
              <span class="lines-removed">−{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            </dd>
          </template>
        </dl>
      </SectionPanel>
    </div>

    <!-- Incidents -->
    <div class="card mb-6">
      <div class="flex items-center gap-2 mb-3">
        <h3 class="incidents-heading">Incidents</h3>
        <Badge :variant="incidents.length > 0 ? 'warning' : 'neutral'">{{ incidents.length }}</Badge>
      </div>
      <div v-if="incidents.length > 0" class="incidents-list">
        <div v-for="(incident, idx) in incidents" :key="idx" class="incident-row">
          <div class="incident-item">
            <span class="incident-badge-col">
              <Badge :variant="incidentSeverityVariant(incident.severity)" size="sm">
                {{ incidentTypeLabel(incident.eventType) }}
              </Badge>
            </span>
            <span class="incident-summary">
              <template v-if="isLongSummary(incident.summary)">
                <template v-if="expandedIncidents.has(idx)">
                  {{ incident.summary }}
                  <button class="expand-btn" @click="toggleExpand(idx)">Show less</button>
                </template>
                <template v-else>
                  {{ truncateText(incident.summary, 80) }}
                  <button class="expand-btn" @click="toggleExpand(idx)">Show more</button>
                </template>
              </template>
              <template v-else>{{ incident.summary }}</template>
            </span>
            <span class="incident-actions">
              <button
                v-if="hasDetail(incident)"
                class="detail-toggle-btn"
                :title="expandedDetails.has(idx) ? 'Hide full event data' : 'Show full event data'"
                @click="toggleDetail(idx)"
              >
                {{ expandedDetails.has(idx) ? '▾' : '▸' }} Detail
              </button>
            </span>
            <span v-if="incident.timestamp" class="incident-time text-muted">
              {{ formatTime(incident.timestamp) }}
            </span>
          </div>
          <div v-if="expandedDetails.has(idx) && hasDetail(incident)" class="incident-detail">
            <pre class="incident-detail-json">{{ formatObjectResult(incident.detailJson) }}</pre>
          </div>
        </div>
      </div>
      <p v-else class="text-muted incidents-empty">
        No incidents recorded for this session.
      </p>
    </div>

    <BackgroundTasksPanel
      v-if="capabilities.hasBackgroundTasks && store.backgroundTasks.length > 0"
      :tasks="store.backgroundTasks"
      :live="sessionLive"
      class="mb-6"
    />

    <!-- Session Plan -->
    <SectionPanel
      v-if="store.plan"
      title="Session Plan"
      class="mb-6"
    >
      <template #actions>
        <button class="detail-toggle-btn" @click="isPlanExpanded = !isPlanExpanded">
          {{ isPlanExpanded ? 'Hide' : 'Show' }}
        </button>
      </template>
      <div v-if="isPlanExpanded" class="plan-content">
        <MarkdownContent :content="store.plan.content" />
      </div>
    </SectionPanel>

    <!-- File-history checkpoints (sources that back up files) -->
    <FileHistoryPanel
      v-if="capabilities.hasFileHistory && store.fileHistory.length > 0"
      :checkpoints="store.fileHistory"
      :session-id="store.sessionId"
      class="mb-6"
    />

    <!-- Checkpoints -->
    <SectionPanel
      v-if="store.checkpoints.length > 0"
      :title="`Checkpoints (${store.checkpoints.length})`"
      class="mb-6"
    >
      <template #actions>
        <button
          class="cp-toggle-all-btn"
          @click="timelineRef?.allExpanded ? timelineRef?.collapseAll() : timelineRef?.expandAll()"
        >
          {{ timelineRef?.allExpanded ? 'Collapse all' : 'Expand all' }}
        </button>
      </template>
      <CheckpointTimeline
        ref="timelineRef"
        :checkpoints="store.checkpoints"
        :focus-number="store.pendingCheckpointFocus"
        @update:focus-number="store.focusCheckpoint($event)"
      />
    </SectionPanel>
  </div>
</template>


<style scoped>
.cwd-value {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cwd-path {
  display: flex;
  min-width: 0;
  white-space: nowrap;
}

.cwd-path__head {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.cwd-path__tail {
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cwd-copy {
  flex-shrink: 0;
  padding: 2px 4px;
}

.summary-prose--empty {
  font-style: italic;
}

.def-list--spaced {
  margin-top: 14px;
}

.lines-added {
  color: var(--success-fg);
  font-weight: 600;
}

.lines-sep {
  color: var(--text-tertiary);
}

.lines-removed {
  color: var(--danger-fg);
  font-weight: 600;
}

.incidents-heading {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}

.incidents-empty {
  font-size: 0.875rem;
  margin: 0;
}

.incidents-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.incident-row {
  border-bottom: 1px solid var(--border);
}

.incident-row:last-child {
  border-bottom: none;
}

.incident-item {
  display: grid;
  grid-template-columns: 90px 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0;
}

.incident-badge-col {
  display: flex;
}

.incident-summary {
  font-size: 0.875rem;
  line-height: 1.4;
  min-width: 0;
}

.incident-actions {
  white-space: nowrap;
}

.incident-time {
  font-size: 0.75rem;
  white-space: nowrap;
  min-width: 72px;
  text-align: right;
}

.detail-toggle-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  transition: all 0.15s;
}

.detail-toggle-btn:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.incident-detail {
  padding: 0.25rem 0 0.5rem 0;
  margin-left: calc(90px + 0.5rem);
}

.incident-detail-json {
  background: var(--surface-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.expand-btn {
  background: none;
  border: none;
  color: var(--accent-fg);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0 0.25rem;
  text-decoration: underline;
}

.expand-btn:hover {
  opacity: 0.8;
}

.plan-content {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-primary);
}

.cp-toggle-all-btn {
  background: none;
  border: none;
  color: var(--accent-fg);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 4px);
}

.cp-toggle-all-btn:hover {
  background: var(--surface-secondary);
}

</style>
