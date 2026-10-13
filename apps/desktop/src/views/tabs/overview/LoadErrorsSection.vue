<script setup lang="ts">
/** Overview: an inline, retryable alert for each section that failed to load. */
import { ErrorAlert } from "@tracepilot/ui";
import { useOverviewModel } from "./overviewModel";

const { store } = useOverviewModel();

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
</template>
