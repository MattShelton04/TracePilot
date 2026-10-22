<script setup lang="ts">
/**
 * The Code page: headline numbers, lines added and removed per day, then
 * file types beside the most-modified files. Built from the Analytics
 * dashboard's pieces; each panel empties on its own, and a filter change
 * keeps the current results on screen until the new ones land.
 */
import { ErrorState, LoadingOverlay, PageShell } from "@tracepilot/ui";
import { computed, ref } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import CodeChangesPanel from "@/components/codeImpact/CodeChangesPanel.vue";
import CodeFilesPanel from "@/components/codeImpact/CodeFilesPanel.vue";
import CodeFileTypesPanel from "@/components/codeImpact/CodeFileTypesPanel.vue";
import CodeKpis from "@/components/codeImpact/CodeKpis.vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { useValueTween } from "@/composables/useValueTween";
import { analyticsScopeWords, rangeDays } from "@/utils/analyticsDashboard";
import { codeDayRows } from "@/utils/codeImpact";
import "@/styles/features/analytics-dashboard.css";

const { store } = useAnalyticsPage("fetchCodeImpact");

const loading = computed(() => store.codeImpactLoading);
const data = computed(() => store.codeImpact);
const refreshing = computed(() => store.codeImpactRefreshing);

const contentRoot = ref<HTMLElement | null>(null);
const { revealing } = useFirstReveal({
  key: "code",
  ready: () => !loading.value && !!data.value,
  root: contentRoot,
  countUpSelector: ".kpi__value-num",
});
useValueTween({ root: contentRoot, selector: ".kpi__value-num", source: data });

const pageSubtitle = computed(() => {
  const { all, suffix } = analyticsScopeWords(store);
  return `Code changes and file modifications across ${all}${store.sourcePrefix}sessions${suffix}`;
});

const linesChanged = computed(
  () => !!data.value && data.value.linesAdded + data.value.linesRemoved > 0,
);

const rows = computed(() => {
  if (!data.value) return [];
  const days = rangeDays(
    data.value.changesByDay.map((day) => day.date),
    store.dateRange,
  );
  return codeDayRows(data.value, days);
});
</script>

<template>
  <PageShell>
    <AnalyticsPageHeader title="Code Impact" :subtitle="pageSubtitle" />
    <LoadingOverlay :loading="loading" message="Loading code impact data…">
      <ErrorState
        v-if="store.codeImpactError"
        heading="Failed to load code impact data"
        :message="store.codeImpactError"
        @retry="store.fetchCodeImpact({ force: true })"
      />
      <div
        v-else-if="data"
        ref="contentRoot"
        class="ad-page"
        :class="{ 'chart-reveal': revealing }"
        :data-refreshing="refreshing"
        :aria-busy="refreshing"
      >
        <CodeKpis :data="data" :rows="rows" :one-repo="!!store.selectedRepo" />
        <CodeChangesPanel :rows="rows" />
        <div class="ad-pair">
          <CodeFileTypesPanel :breakdown="data.fileTypeBreakdown" :lines-changed="linesChanged" />
          <CodeFilesPanel
            :files="data.mostModifiedFiles"
            :unique-files="data.filesModified"
            :lines-changed="linesChanged"
          />
        </div>
      </div>
    </LoadingOverlay>
  </PageShell>
</template>
