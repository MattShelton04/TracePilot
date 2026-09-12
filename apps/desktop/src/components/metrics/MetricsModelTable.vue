<script setup lang="ts">
import {
  Badge,
  DataTable,
  formatAiCredits,
  formatNumber,
  SectionPanel,
  TokenBar,
  Tooltip,
} from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed } from "vue";
import type { MetricsModelEntry } from "@/composables/useMetricsTabData";

const props = defineProps<{
  modelEntries: MetricsModelEntry[];
  totalTokens: number;
  hasReasoningData: boolean;
  hideDistribution?: boolean;
}>();
const tokenColumns = computed(() => [
  { key: "input", label: "Input total", align: "right" as const },
  { key: "cacheRead", label: "Cache read", align: "right" as const },
  { key: "notCached", label: "Not cached", align: "right" as const },
  { key: "output", label: "Output", align: "right" as const },
  ...(props.hasReasoningData
    ? [{ key: "reasoning", label: "Of which reasoning", align: "right" as const }]
    : []),
  { key: "total", label: "Total", align: "right" as const },
]);
const columns = computed(() => [
  { key: "name", label: "Model" },
  { key: "requests", label: "Requests", align: "right" as const },
  { key: "aiCredits", label: "AI Credits", align: "right" as const },
  { key: "aiCreditSource", label: "Source" },
  ...tokenColumns.value,
]);
const rows = computed(() => props.modelEntries.map((entry) => ({ ...entry, ...entry.tokens })));
</script>

<template>
  <SectionPanel v-if="!hideDistribution && modelEntries.length > 0 && modelEntries.every(m => m.tokens.total != null)" title="Token Distribution" class="mb-6">
    <div class="space-y-3">
      <TokenBar v-for="model in modelEntries" :key="model.name" :label="model.name"
        :value="model.tokens.total != null ? formatNumber(model.tokens.total) : '—'"
        :percentage="totalTokens > 0 ? (model.totalTokens / totalTokens) * 100 : 0" color="var(--accent-emphasis)" />
    </div>
  </SectionPanel>
  <SectionPanel v-if="modelEntries.length" title="Model Usage">
    <template #actions><Tooltip text="Cache read and Not cached partition input tokens. Reasoning is included in output. Total is input + output. A dash means unavailable."><button type="button" aria-label="About token accounting" class="text-[var(--text-tertiary)]"><Info :size="14" /></button></Tooltip></template>
    <DataTable :columns="columns" :rows="rows" class="mb-3" style="overflow-x: auto;">
      <template #cell-name="{ value }"><Badge variant="done">{{ value }}</Badge></template>
      <template #cell-requests="{ value }">{{ value == null ? '—' : formatNumber(value as number) }}</template>
      <template #cell-aiCredits="{ value }">{{ formatAiCredits(value as number | null) }}</template>
      <template #cell-aiCreditSource="{ value }">
        <Badge :variant="value === 'observed' ? 'success' : 'neutral'">
          {{ value === 'observed' ? 'Observed' : value === 'unavailable' ? 'Unavailable' : 'Estimated' }}
        </Badge>
      </template>
      <template v-for="column in tokenColumns" :key="column.key" #[`cell-${column.key}`]="{ value }">
        {{ value != null ? formatNumber(value as number) : '—' }}
      </template>
    </DataTable>
  </SectionPanel>
</template>
