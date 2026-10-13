<script setup lang="ts">
/** Overview: the session's context (model, effort, host, paths) beside its outcome tiles. */
import { modelDisplayName } from "@tracepilot/types";
import { computed } from "vue";
import SessionContextPanel from "@/components/overview/SessionContextPanel.vue";
import SessionOutcomeTiles from "@/components/overview/SessionOutcomeTiles.vue";
import { sessionEffort, sessionModel } from "@/utils/sessionModel";
import { useOverviewModel } from "./overviewModel";

const {
  store,
  detail,
  metrics,
  codeChanges,
  incidents,
  live,
  source,
  capabilities,
  isClaude,
  activeNow,
  spanMs,
  segments,
  outcomeStatus,
  scrollToSection,
} = useOverviewModel();

const currentModel = computed(() => sessionModel(detail.value));
const currentEffort = computed(() => sessionEffort(detail.value));
// Named as cards and Analytics name it; the recorded id is the tooltip.
const currentModelLabel = computed(() =>
  currentModel.value ? modelDisplayName(currentModel.value, source.value) : null,
);
// Copilot always reports its host; other sources show it only when recorded.
const showHost = computed(() => source.value === "copilot" || detail.value?.hostType != null);
const runCount = computed(() => Math.max(segments.value.length, 1));
</script>

<template>
  <div v-if="detail" class="overview-row mb-4">
    <SessionContextPanel
      :detail="detail"
      :model="currentModel"
      :model-label="currentModelLabel"
      :effort="currentEffort"
      :show-host="showHost"
      :is-claude="isClaude"
      :running="activeNow"
    />
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
      :status="outcomeStatus"
      @jump="scrollToSection"
    />
  </div>
</template>

<style scoped>
.overview-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}

/* Sized by the Overview tab's container. */
@container (max-width: 860px) {
  .overview-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
