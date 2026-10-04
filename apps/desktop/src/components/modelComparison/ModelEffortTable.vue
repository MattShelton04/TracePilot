<script setup lang="ts">
/**
 * Reasoning effort comparison: user turns per model and effort across the
 * selected sessions, with what each took per turn.
 */
import { computed } from "vue";
import EffortUsageTable from "@/components/effort/EffortUsageTable.vue";
import { useModelComparisonContext } from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();
const entries = computed(() => ctx.data?.reasoningEffort ?? []);
</script>

<template>
  <div v-if="entries.length" class="section-panel mb-4">
    <div class="section-panel-header">
      <span>Reasoning Effort</span>
    </div>
    <div class="section-panel-body">
      <EffortUsageTable :entries="entries" show-sessions />
    </div>
  </div>
</template>
