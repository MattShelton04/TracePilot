<script setup lang="ts">
import { EmptyState, ErrorState, LoadingOverlay, PageShell } from "@tracepilot/ui";
import { provide } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import ModelCharts from "@/components/modelComparison/ModelCharts.vue";
import ModelCompareTable from "@/components/modelComparison/ModelCompareTable.vue";
import ModelLeaderboard from "@/components/modelComparison/ModelLeaderboard.vue";
import ModelStatsGrid from "@/components/modelComparison/ModelStatsGrid.vue";
import {
  ModelComparisonKey,
  useModelComparison,
} from "@/composables/useModelComparison";
import "@/styles/features/model-comparison.css";

const ctx = useModelComparison();
provide(ModelComparisonKey, ctx);
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
            v-if="ctx.modelRows.length === 0"
            icon="🤖"
            title="No Model Data"
            message="No model usage data found for the selected time range and repository."
          />

          <template v-else>
            <ModelStatsGrid />
            <ModelLeaderboard />
            <ModelCharts />
            <ModelCompareTable />
          </template>
        </template>
      </LoadingOverlay>
    </div>
  </PageShell>
</template>
