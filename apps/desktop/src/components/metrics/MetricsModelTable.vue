<script setup lang="ts">
import {
  Badge,
  DataTable,
  formatCost,
  formatNumber,
  SectionPanel,
  TokenBar,
} from "@tracepilot/ui";
import { computed } from "vue";
import type { MetricsModelEntry } from "@/composables/useMetricsTabData";

const props = defineProps<{
  modelEntries: MetricsModelEntry[];
  totalTokens: number;
  hasReasoningData: boolean;
}>();

const modelColumns = computed(() => {
  const cols = [
    { key: "name", label: "Model", align: "left" as const },
    { key: "requests", label: "Requests", align: "right" as const },
    { key: "copilotCost", label: "Copilot Cost", align: "right" as const },
    { key: "wholesaleCost", label: "Wholesale Cost", align: "right" as const },
    { key: "inputTokens", label: "Input Tokens", align: "right" as const },
    { key: "outputTokens", label: "Output Tokens", align: "right" as const },
  ];
  if (props.hasReasoningData) {
    cols.push({
      key: "reasoningTokens",
      label: "Reasoning",
      align: "right" as const,
      class: "hidden lg:table-cell",
    } as (typeof cols)[number]);
  }
  cols.push(
    {
      key: "cacheReadTokens",
      label: "Cache Read",
      align: "right" as const,
      class: "hidden lg:table-cell",
    } as (typeof cols)[number],
    {
      key: "cacheWriteTokens",
      label: "Cache Write",
      align: "right" as const,
      class: "hidden lg:table-cell",
    } as (typeof cols)[number],
    { key: "totalTokens", label: "Total", align: "right" as const },
  );
  return cols;
});
</script>

<template>
  <SectionPanel v-if="modelEntries.length > 0" title="Token Distribution" class="mb-6">
    <div class="space-y-3">
      <TokenBar
        v-for="model in modelEntries"
        :key="model.name"
        :label="model.name"
        :value="formatNumber(model.totalTokens)"
        :percentage="totalTokens > 0 ? (model.totalTokens / totalTokens) * 100 : 0"
        color="var(--accent-emphasis)"
      />
    </div>
  </SectionPanel>

  <DataTable v-if="modelEntries.length > 0" :columns="modelColumns" :rows="modelEntries" class="mb-6">
    <template #cell-name="{ value }">
      <Badge variant="done">{{ value }}</Badge>
    </template>
    <template #cell-requests="{ value }">
      <span class="text-[var(--text-primary)]">{{ value }}</span>
    </template>
    <template #cell-copilotCost="{ value }">
      <span class="text-[var(--warning-fg)]">{{ formatCost(value as number) }}</span>
    </template>
    <template #cell-wholesaleCost="{ value }">
      <span :class="value != null ? 'text-[var(--done-fg)]' : 'text-[var(--text-placeholder)]'">
        {{ value != null ? formatCost(value as number) : '—' }}
      </span>
    </template>
    <template #cell-inputTokens="{ value }">
      <span class="text-[var(--text-secondary)]">{{ formatNumber(value as number) }}</span>
    </template>
    <template #cell-outputTokens="{ value }">
      <span class="text-[var(--text-secondary)]">{{ formatNumber(value as number) }}</span>
    </template>
    <template v-if="hasReasoningData" #cell-reasoningTokens="{ value }">
      <span :class="value != null ? 'text-[var(--text-secondary)]' : 'text-[var(--text-placeholder)]'">
        {{ value != null ? formatNumber(value as number) : 'N/A' }}
      </span>
    </template>
    <template #cell-cacheReadTokens="{ value }">
      <span class="text-[var(--text-tertiary)]">{{ formatNumber(value as number) }}</span>
    </template>
    <template #cell-cacheWriteTokens="{ value }">
      <span class="text-[var(--text-tertiary)]">{{ formatNumber(value as number) }}</span>
    </template>
    <template #cell-totalTokens="{ value }">
      <span class="font-semibold text-[var(--text-primary)]">{{ formatNumber(value as number) }}</span>
    </template>
  </DataTable>
</template>
