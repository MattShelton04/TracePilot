<script setup lang="ts">
/**
 * OverviewTab — loads the Overview's data and renders its sections from the
 * registry in `./overview/overviewSections.ts`. Shared derived state lives in
 * `./overview/overviewModel.ts`; each section owns the rest.
 */
import { useSessionTabLoader } from "@tracepilot/ui";
import { computed, provide, ref, watch } from "vue";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { createOverviewModel, OVERVIEW_MODEL_KEY } from "./overview/overviewModel";
import { visibleOverviewSections } from "./overview/overviewSections";

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

const model = createOverviewModel(store);
provide(OVERVIEW_MODEL_KEY, model);
const { detail, capabilities, activityLoaded } = model;

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

const sections = computed(() => visibleOverviewSections(model));

const overviewRoot = ref<HTMLElement | null>(null);

const { revealing } = useFirstReveal({
  key: () => store.sessionId && `overview:${store.sessionId}`,
  ready: () => !!detail.value && activityLoaded.value,
  root: overviewRoot,
  countUpSelector: ".kpi__value-num",
});
</script>

<template>
  <div ref="overviewRoot" class="overview" :class="{ 'chart-reveal': revealing }">
    <component :is="section.component" v-for="section in sections" :key="section.id" />
  </div>
</template>


<style scoped>
.overview {
  container-type: inline-size;
}

/* Leaves room for the sticky session header when a tile scrolls here.
   Applies to each section's root anchor element. */
.overview-anchor {
  scroll-margin-top: 96px;
}
</style>
