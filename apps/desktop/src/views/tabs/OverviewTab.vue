<script setup lang="ts">
import { modelDisplayName } from "@tracepilot/types";
import {
  Badge,
  ErrorAlert,
  formatAiCredits,
  formatTime,
  MarkdownContent,
  SectionPanel,
  truncateText,
  useSessionTabLoader,
} from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import CheckpointTimeline from "@/components/checkpoints/CheckpointTimeline.vue";
import FileHistoryPanel from "@/components/checkpoints/FileHistoryPanel.vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import SessionActivityChart from "@/components/overview/SessionActivityChart.vue";
import SessionContextPanel from "@/components/overview/SessionContextPanel.vue";
import SessionOutcomeTiles, {
  type OverviewSection,
} from "@/components/overview/SessionOutcomeTiles.vue";
import SessionOverviewKpis, {
  type OverviewCost,
} from "@/components/overview/SessionOverviewKpis.vue";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionLiveState } from "@/composables/useSessionLiveState";
import { allowsAiCreditEstimate } from "@/composables/useSessionMetrics";
import { useSessionSource } from "@/composables/useSessionSource";
import { usePreferencesStore } from "@/stores/preferences";
import { formatObjectResult } from "@/utils/formatResult";
import { sessionEffort, sessionModel } from "@/utils/sessionModel";
import { type ActivityMarker, isRateLimit, type TimeWindow } from "@/utils/sessionOverview";
import { formatSessionCost, formatUsd, sessionCostEstimate } from "@/utils/sourceCost";

const store = useSessionDetailContext();

useSessionTabLoader(
  () => store.sessionId,
  () => {
    store.loadPlan();
    store.loadShutdownMetrics();
    store.loadIncidents();
    store.loadTurnActivity();
  },
);

const detail = computed(() => store.detail);
const currentModel = computed(() => sessionModel(detail.value));
const currentEffort = computed(() => sessionEffort(detail.value));
const metrics = computed(() => store.shutdownMetrics);
// An empty change record (no lines, no files) reads as "none recorded".
const codeChanges = computed(() => {
  const changes = metrics.value?.codeChanges;
  if (!changes) return undefined;
  const lines = (changes.linesAdded ?? 0) + (changes.linesRemoved ?? 0);
  return lines > 0 || changes.filesModified?.length ? changes : undefined;
});
const incidents = computed(() => store.incidents);
const prefs = usePreferencesStore();
const live = useSessionLiveState();
const { source, capabilities } = useSessionSource(
  () => store.sessionId,
  () => store.detail,
);
const isClaude = computed(() => source.value === "claudeCode");
// Named as cards and Analytics name it; the recorded id is the tooltip.
const currentModelLabel = computed(() =>
  currentModel.value ? modelDisplayName(currentModel.value, source.value) : null,
);
// Only sources that back up files are asked for their history.
watch(
  () => (capabilities.value.hasFileHistory ? store.sessionId : null),
  (id) => {
    if (id) store.loadFileHistory();
  },
  { immediate: true },
);
// Only sources that write checkpoints are asked for them, so a running
// session's refresh never re-fetches a list that is always empty.
watch(
  () => (capabilities.value.hasCheckpoints ? store.sessionId : null),
  (id) => {
    if (id) store.loadCheckpoints();
  },
  { immediate: true },
);
// Copilot always reports its host; other sources show it only when recorded.
const showHost = computed(() => source.value === "copilot" || detail.value?.hostType != null);
const { aiCreditUsage } = useMetricsTabData(
  metrics,
  prefs,
  () => !allowsAiCreditEstimate(source.value),
);

function parseTime(value: string | null | undefined): number | null {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

// A running session that has been waiting for hours did not last until
// now: only recent activity counts as ongoing in the duration and timeline.
const ACTIVE_WITHIN_MS = 10 * 60_000;
const activeNow = computed(() => {
  if (!live.value.running) return false;
  const updated = parseTime(detail.value?.updatedAt);
  return updated != null && Date.now() - updated < ACTIVE_WITHIN_MS;
});

const spanMs = computed(() => {
  const start = parseTime(detail.value?.createdAt);
  const end = parseTime(detail.value?.updatedAt);
  return start != null && end != null && end > start ? end - start : null;
});
const turnCount = computed(() => detail.value?.turnCount ?? 0);

const cost = computed<OverviewCost>(() => {
  const turns = turnCount.value;
  if (!capabilities.value.hasAic) {
    const estimate = sessionCostEstimate(source.value, metrics.value);
    return {
      label: "Est. cost",
      value: formatSessionCost(estimate),
      basis: estimate.basisLabel,
      partial: estimate.partial,
      perTurn: estimate.amount != null && turns > 0 ? formatUsd(estimate.amount / turns) : null,
      tooltip: estimate.coverage,
    };
  }
  const { credits, source: creditSource } = aiCreditUsage.value;
  return {
    label: "AI credits",
    value: formatAiCredits(credits),
    basis:
      credits == null
        ? "Not recorded"
        : creditSource === "observed"
          ? "Observed billing"
          : "Estimated",
    partial: false,
    perTurn: credits != null && turns > 0 ? formatAiCredits(credits / turns) : null,
    tooltip:
      creditSource === "observed"
        ? "Observed Copilot billing telemetry"
        : "Estimated for historical session data",
  };
});

const segments = computed(() => metrics.value?.sessionSegments ?? []);
const runCount = computed(() => Math.max(segments.value.length, 1));

/** Stretches between recorded runs, when the session was not running. */
const gaps = computed<TimeWindow[]>(() => {
  const out: TimeWindow[] = [];
  for (let i = 1; i < segments.value.length; i++) {
    const start = parseTime(segments.value[i - 1].endTimestamp);
    const end = parseTime(segments.value[i].startTimestamp);
    if (start != null && end != null && end > start) out.push({ start, end });
  }
  return out;
});

const INCIDENT_MARKER: Record<string, ActivityMarker["kind"]> = {
  error: "error",
  warning: "warning",
  compaction: "compaction",
  truncation: "truncation",
};

const markers = computed<ActivityMarker[]>(() => {
  const out: ActivityMarker[] = [];
  for (const seg of segments.value.slice(1)) {
    const at = parseTime(seg.startTimestamp);
    if (at != null) out.push({ kind: "resume", at, label: "Resumed" });
  }
  for (const incident of incidents.value) {
    const at = parseTime(incident.timestamp);
    const kind = isRateLimit(incident) ? "warning" : INCIDENT_MARKER[incident.eventType];
    if (at != null && kind) out.push({ kind, at, label: truncateText(incident.summary, 80) });
  }
  for (const snapshot of store.fileHistory) {
    const at = parseTime(snapshot.timestamp);
    if (at == null) continue;
    const prompt = snapshot.prompt?.trim();
    out.push({
      kind: "snapshot",
      at,
      label: prompt
        ? `Snapshot ${snapshot.number}: “${truncateText(prompt, 60)}”`
        : `Snapshot ${snapshot.number}`,
    });
  }
  return out;
});

const activityLoaded = computed(() => store.loaded.has("activity"));

const overviewRoot = ref<HTMLElement | null>(null);
const incidentsRef = ref<HTMLElement | null>(null);
const planRef = ref<HTMLElement | null>(null);
const fileHistoryRef = ref<HTMLElement | null>(null);
const checkpointsRef = ref<HTMLElement | null>(null);

const { revealing } = useFirstReveal({
  key: () => store.sessionId && `overview:${store.sessionId}`,
  ready: () => !!detail.value && activityLoaded.value,
  root: overviewRoot,
  countUpSelector: ".kpi__value-num",
});

function scrollToSection(section: OverviewSection) {
  const target = {
    incidents: incidentsRef,
    plan: planRef,
    fileHistory: fileHistoryRef,
    checkpoints: checkpointsRef,
  }[section].value;
  if (!target) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function onMarkerSelect(kind: ActivityMarker["kind"]) {
  if (kind === "snapshot") scrollToSection("fileHistory");
  else if (kind !== "resume") scrollToSection("incidents");
}

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
  <div ref="overviewRoot" class="overview" :class="{ 'chart-reveal': revealing }">
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

    <SessionOverviewKpis
      v-if="detail"
      class="mb-4"
      :turn-count="turnCount"
      :event-count="detail.eventCount ?? 0"
      :span-ms="spanMs"
      :api-ms="metrics?.totalApiDurationMs"
      :tool-ms="metrics?.totalToolDurationMs"
      :running="activeNow"
      :code-changes="codeChanges"
      :calls="metrics?.coverage?.recordedCalls ?? null"
      :checkpoints="capabilities.hasCheckpoints ? (detail.checkpointCount ?? 0) : null"
      :file-snapshots="store.fileHistory.length"
      :cost="cost"
    />


    <div v-if="detail" class="overview-row mb-4">
      <SessionOutcomeTiles
        :live="live"
        :has-exit-metrics="capabilities.hasExitMetrics"
        :shutdown-type="metrics?.shutdownType"
        :run-count="runCount"
        :updated-at="detail.updatedAt"
        :incidents="incidents"
        :code-changes="codeChanges"
        :file-snapshots="store.fileHistory"
        :checkpoints="store.checkpoints"
        :has-plan="!!store.plan"
        :roots="[detail.gitRoot, detail.cwd]"
        :span-ms="spanMs"
        :api-ms="metrics?.totalApiDurationMs"
        :tool-ms="metrics?.totalToolDurationMs"
        @jump="scrollToSection"
      />
      <SessionContextPanel
        :detail="detail"
        :model="currentModel"
        :model-label="currentModelLabel"
        :effort="currentEffort"
        :show-host="showHost"
        :is-claude="isClaude"
        :running="activeNow"
      />
    </div>

    <OverviewPanel v-if="detail" title="Activity" class="mb-6">
      <template #aside>Turns over time</template>
      <SessionActivityChart
        :created-at="detail.createdAt"
        :updated-at="detail.updatedAt"
        :turn-starts="activityLoaded ? store.turnActivity : null"
        :loading="!activityLoaded"
        :error="store.turnActivityError"
        :markers="markers"
        :gaps="gaps"
        :running="activeNow"
        :is-claude="isClaude"
        @select="onMarkerSelect"
      />
    </OverviewPanel>

    <!-- Incidents -->
    <div ref="incidentsRef" class="card mb-6 overview-anchor">
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

    <!-- Session Plan -->
    <div v-if="store.plan" ref="planRef" class="overview-anchor">
    <SectionPanel
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
    </div>

    <!-- File-history checkpoints (sources that back up files) -->
    <div
      v-if="capabilities.hasFileHistory && store.fileHistory.length > 0"
      ref="fileHistoryRef"
      class="overview-anchor"
    >
      <FileHistoryPanel :checkpoints="store.fileHistory" :session-id="store.sessionId" class="mb-6" />
    </div>

    <!-- Checkpoints -->
    <div v-if="store.checkpoints.length > 0" ref="checkpointsRef" class="overview-anchor">
    <SectionPanel
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
  </div>
</template>


<style scoped>
.overview {
  container-type: inline-size;
}

.overview-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}

@container (max-width: 860px) {
  .overview-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Leaves room for the sticky session header when a tile scrolls here. */
.overview-anchor {
  scroll-margin-top: 96px;
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
