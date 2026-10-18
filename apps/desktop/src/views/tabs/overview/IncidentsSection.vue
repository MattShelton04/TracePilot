<script setup lang="ts">
/** Overview: the session's errors, warnings, compactions and truncations. */
import { Badge, truncateText } from "@tracepilot/ui";
import { computed, ref } from "vue";
import type { SectionStatus } from "@/components/overview/SessionOutcomeTiles.vue";
import { formatObjectResult } from "@/utils/formatResult";
import { eventTimeLabel, isRateLimit, timestampsSpanDays } from "@/utils/sessionOverview";
import { useOverviewModel } from "./overviewModel";

const { incidents, detail, outcomeStatus, anchor } = useOverviewModel();
const root = anchor("incidents");

const incidentsStatus = computed<SectionStatus>(() =>
  incidents.value.length ? "ready" : outcomeStatus.value.incidents,
);

// Clock times alone can't place incidents in a session that crosses midnight.
const withDates = computed(() =>
  timestampsSpanDays([
    detail.value?.createdAt,
    detail.value?.updatedAt,
    ...incidents.value.map((incident) => incident.timestamp),
  ]),
);

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

type Incident = (typeof incidents.value)[number];

// The index records a rate limit as an error; it reads as a warning here, as
// in the outcome tile and the activity chart.
function incidentSeverityVariant(incident: Incident): "danger" | "warning" | "neutral" {
  if (isRateLimit(incident)) return "warning";
  if (incident.severity === "error") return "danger";
  if (incident.severity === "warning") return "warning";
  return "neutral";
}

function incidentTypeLabel(incident: Incident): string {
  if (isRateLimit(incident)) return "Rate limit";
  const { eventType } = incident;
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

function hasDetail(incident: { detailJson?: unknown }): boolean {
  return incident.detailJson != null && incident.detailJson !== "";
}
</script>

<template>
  <div ref="root" class="card mb-6 overview-anchor">
    <div class="flex items-center gap-2 mb-3">
      <h3 class="incidents-heading">Incidents</h3>
      <Badge v-if="incidentsStatus === 'ready'" :variant="incidents.length > 0 ? 'warning' : 'neutral'">{{ incidents.length }}</Badge>
    </div>
    <div v-if="incidents.length > 0" class="incidents-list">
      <div v-for="(incident, idx) in incidents" :key="idx" class="incident-row">
        <div class="incident-item">
          <span class="incident-badge-col">
            <Badge :variant="incidentSeverityVariant(incident)" size="sm">
              {{ incidentTypeLabel(incident) }}
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
          <span
            v-if="incident.timestamp"
            class="incident-time text-muted"
            :title="eventTimeLabel(incident.timestamp, withDates).title"
          >
            {{ eventTimeLabel(incident.timestamp, withDates).text }}
          </span>
        </div>
        <div v-if="expandedDetails.has(idx) && hasDetail(incident)" class="incident-detail">
          <pre class="incident-detail-json">{{ formatObjectResult(incident.detailJson) }}</pre>
        </div>
      </div>
    </div>
    <p v-else-if="incidentsStatus === 'pending'" role="status" class="text-muted incidents-empty">
      Loading incidents…
    </p>
    <p v-else-if="incidentsStatus === 'error'" class="text-muted incidents-empty">
      Couldn't load incidents for this session.
    </p>
    <p v-else class="text-muted incidents-empty">
      No incidents recorded for this session.
    </p>
  </div>
</template>

<style scoped>
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
</style>
