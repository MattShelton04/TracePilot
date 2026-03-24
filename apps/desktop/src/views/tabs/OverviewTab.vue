<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import {
  StatCard, Badge, SectionPanel, DefList, ErrorAlert,
  formatDate, formatDuration, formatNumberFull, formatTime, truncateText, useSessionTabLoader, MarkdownContent,
} from "@tracepilot/ui";

const store = useSessionDetailStore();

useSessionTabLoader(
  () => store.sessionId,
  () => {
    store.loadCheckpoints();
    store.loadPlan();
    store.loadShutdownMetrics();
    store.loadIncidents();
  }
);

const detail= computed(() => store.detail);
const metrics = computed(() => store.shutdownMetrics);
const incidents = computed(() => store.incidents);

const sessionInfoItems = computed(() => {
  const d = detail.value;
  return [
    { label: "Session ID", value: d?.id ?? "—" },
    { label: "Repository", value: d?.repository ?? "—" },
    { label: "Branch", value: d?.branch ?? "—" },
    { label: "Model", value: metrics.value?.currentModel ?? "—" },
    { label: "Host", value: d?.hostType ?? "—" },
    { label: "Duration", value: formatDuration(metrics.value?.totalApiDurationMs) },
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

function incidentSeverityVariant(severity: string): 'danger' | 'warning' | 'neutral' {
  if (severity === 'error') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'neutral';
}

function incidentTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    error: 'Error',
    warning: 'Warning',
    compaction: 'Compaction',
    truncation: 'Truncation',
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

const expandedCheckpoints = ref<Set<number>>(new Set());

function toggleCheckpoint(num: number) {
  if (expandedCheckpoints.value.has(num)) {
    expandedCheckpoints.value.delete(num);
  } else {
    expandedCheckpoints.value.add(num);
  }
}

const isPlanExpanded = ref(true);

function hasDetail(incident: { detailJson?: unknown }): boolean {
  return incident.detailJson != null && incident.detailJson !== '';
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function retryLoadSection(section: string) {
  store.loaded.delete(section);
  switch (section) {
    case 'checkpoints': store.loadCheckpoints(); break;
    case 'plan': store.loadPlan(); break;
    case 'metrics': store.loadShutdownMetrics(); break;
    case 'incidents': store.loadIncidents(); break;
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
      <StatCard :value="detail?.checkpointCount ?? 0" label="Checkpoints" color="success" />
      <StatCard
        :value="metrics?.totalPremiumRequests != null ? formatNumberFull(metrics.totalPremiumRequests) : '—'"
        label="Premium Requests"
        color="done"
      />
    </div>

    <!-- Two-column layout -->
    <div class="grid-2 mb-6">
      <!-- Session Info -->
      <SectionPanel title="Session Info">
        <DefList :items="sessionInfoItems" />
      </SectionPanel>

      <!-- Session Summary -->
      <SectionPanel title="Session Summary">
        <p v-if="summaryText" class="summary-prose">{{ summaryText }}</p>
        <p v-else class="summary-prose" style="font-style: italic;">No summary available.</p>
        <dl class="def-list" style="margin-top: 14px;">
          <dt>API Duration</dt>
          <dd>{{ formatDuration(metrics?.totalApiDurationMs) }}</dd>
          <dt>Current Model</dt>
          <dd>
            <Badge v-if="metrics?.currentModel" variant="done">{{ metrics.currentModel }}</Badge>
            <span v-else>—</span>
          </dd>
          <dt>Shutdown Type</dt>
          <dd>{{ metrics?.shutdownType ?? "—" }}</dd>
          <template v-if="metrics?.codeChanges">
            <dt>Code Changes</dt>
            <dd>
              <span style="color: var(--success-fg); font-weight: 600;">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
              <span style="color: var(--text-tertiary);"> / </span>
              <span style="color: var(--danger-fg); font-weight: 600;">−{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            </dd>
          </template>
        </dl>
      </SectionPanel>
    </div>

    <!-- Incidents -->
    <div class="card mb-6">
      <div class="flex items-center gap-2 mb-3">
        <h3 style="margin: 0; font-size: 0.875rem; font-weight: 600;">Incidents</h3>
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
            <pre class="incident-detail-json">{{ formatDetail(incident.detailJson) }}</pre>
          </div>
        </div>
      </div>
      <p v-else class="text-muted" style="font-size: 0.875rem; margin: 0;">
        No incidents recorded for this session.
      </p>
    </div>

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

    <!-- Checkpoints -->
    <SectionPanel
      v-if="store.checkpoints.length > 0"
      :title="`Checkpoints (${store.checkpoints.length})`"
      class="mb-6"
    >
      <div
        v-for="cp in store.checkpoints"
        :key="cp.number"
        class="checkpoint-row"
      >
        <div class="checkpoint-item" @click="toggleCheckpoint(cp.number)">
          <div class="checkpoint-number">{{ cp.number }}</div>
          <div class="checkpoint-body">
            <div class="checkpoint-title">{{ cp.title }}</div>
            <div class="checkpoint-file font-mono">{{ cp.filename }}</div>
          </div>
          <div class="checkpoint-actions">
            <button v-if="cp.content" class="detail-toggle-btn">
              {{ expandedCheckpoints.has(cp.number) ? 'Hide Content' : 'View Content' }}
            </button>
          </div>
        </div>
        <div v-if="expandedCheckpoints.has(cp.number) && cp.content" class="checkpoint-content">
          <MarkdownContent :content="cp.content" />
        </div>
      </div>
    </SectionPanel>
  </div>
</template>


<style scoped>
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

.checkpoint-row {
  border-bottom: 1px solid var(--border);
}
.checkpoint-row:last-child {
  border-bottom: none;
}

.checkpoint-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0;
  cursor: pointer;
  transition: background 0.15s;
}
.checkpoint-item:hover {
  background: var(--surface-secondary);
}

.checkpoint-number {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-tertiary);
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.checkpoint-body {
  flex-grow: 1;
  min-width: 0;
}

.checkpoint-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.checkpoint-file {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.checkpoint-actions {
  flex-shrink: 0;
}

.checkpoint-content {
  padding: 0 1rem 1rem 3rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
</style>
