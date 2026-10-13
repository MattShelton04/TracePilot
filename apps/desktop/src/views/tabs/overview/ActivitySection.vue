<script setup lang="ts">
/** Overview: turns over time, with resumes, incidents and snapshots marked. */
import { truncateText } from "@tracepilot/ui";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import SessionActivityChart from "@/components/overview/SessionActivityChart.vue";
import { type ActivityMarker, isRateLimit, type TimeWindow } from "@/utils/sessionOverview";
import { parseTime, useOverviewModel } from "./overviewModel";

const { store, detail, incidents, isClaude, activeNow, segments, activityLoaded, scrollToSection } =
  useOverviewModel();

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

function onMarkerSelect(kind: ActivityMarker["kind"]) {
  if (kind === "snapshot") scrollToSection("fileHistory");
  else if (kind !== "resume") scrollToSection("incidents");
}
</script>

<template>
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
</template>
