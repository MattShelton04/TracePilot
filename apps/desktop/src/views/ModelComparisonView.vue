<script setup lang="ts">
import { EmptyState, ErrorState, LoadingOverlay, PageShell } from "@tracepilot/ui";
import { Bot } from "lucide-vue-next";
import { provide, ref } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import ModelMixTimeline from "@/components/modelComparison/charts/ModelMixTimeline.vue";
import ModelCharts from "@/components/modelComparison/ModelCharts.vue";
import ModelCompareTable from "@/components/modelComparison/ModelCompareTable.vue";
import ModelLeaderboard from "@/components/modelComparison/ModelLeaderboard.vue";
import ModelStatsGrid from "@/components/modelComparison/ModelStatsGrid.vue";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { ModelComparisonKey, useModelComparison } from "@/composables/useModelComparison";
import "@/styles/features/model-comparison.css";

const ctx = useModelComparison();
provide(ModelComparisonKey, ctx);

const contentRoot = ref<HTMLElement | null>(null);
const { revealing } = useFirstReveal({
  key: "models",
  ready: () => !ctx.loading && !!ctx.data && ctx.modelRows.length > 0,
  root: contentRoot,
  countUpSelector: ".stat-card-value, .model-card-stat-value",
});
</script>

<template>
  <PageShell>
    <div class="model-comparison-feature">
      <AnalyticsPageHeader title="Model Comparison" :subtitle="ctx.pageSubtitle" />
      <LoadingOverlay :loading="ctx.loading" message="Loading model comparison…">
        <ErrorState
          v-if="ctx.store.analyticsError"
          heading="Failed to load model comparison"
          :message="ctx.store.analyticsError"
          @retry="ctx.store.fetchAnalytics({ force: true })"
        />

        <template v-else-if="ctx.data">
          <!-- Empty State -->
          <EmptyState
            v-if="ctx.modelRows.length === 0 && !ctx.data.modelUsageByDay?.length"
            title="No Model Data"
            description="No model usage data found for the selected time range and repository."
          >
            <template #icon>
              <Bot :size="32" />
            </template>
          </EmptyState>

          <!-- Runs ended in the range, but no session was last active in it. -->
          <div v-else-if="ctx.modelRows.length === 0">
            <p class="chart-placeholder">
              No session ended in this range, so there are no per-model totals. The timeline shows runs
              from sessions resumed after it.
            </p>
            <ModelMixTimeline />
          </div>

          <div v-else ref="contentRoot" :class="{ 'chart-reveal': revealing }">
            <ModelStatsGrid />
            <ModelLeaderboard />
            <ModelCharts />
            <ModelCompareTable />
          </div>
        </template>
      </LoadingOverlay>
    </div>
  </PageShell>
</template>
