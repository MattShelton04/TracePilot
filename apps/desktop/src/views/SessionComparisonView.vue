<script setup lang="ts">
import { PageShell } from "@tracepilot/ui";
import { provide } from "vue";
import ComparisonCharts from "@/components/sessionComparison/ComparisonCharts.vue";
import ComparisonHeader from "@/components/sessionComparison/ComparisonHeader.vue";
import ComparisonMetrics from "@/components/sessionComparison/ComparisonMetrics.vue";
import { SessionComparisonKey, useSessionComparison } from "@/composables/useSessionComparison";
import "@/styles/features/session-comparison.css";

const comp = useSessionComparison();

provide(SessionComparisonKey, comp);
</script>

<template>
  <PageShell>
    <div class="session-comparison-feature">
      <ComparisonHeader />

      <template v-if="comp.compared">
        <ComparisonMetrics />
        <ComparisonCharts />
      </template>
    </div>
  </PageShell>
</template>
