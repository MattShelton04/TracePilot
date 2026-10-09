<script setup lang="ts">
import { sourceLabel } from "@tracepilot/types";
import {
  formatAiCredits,
  formatCost,
  formatNumber,
  formatNumberFull,
  SectionPanel,
} from "@tracepilot/ui";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import type { SourceCostRow } from "@/utils/analyticsCostSeries";

defineProps<{ rows: SourceCostRow[] }>();

function costText(row: SourceCostRow): string {
  if (row.amount == null) return "Unpriced";
  return row.unit === "aic" ? formatAiCredits(row.amount) : formatCost(row.amount);
}

function basisText(row: SourceCostRow): string {
  const partial = row.partial ? " · partial" : "";
  if (row.unit === "aic") {
    return row.usdEquivalent == null
      ? `AI Credits${partial}`
      : `AI Credits ≈ ${formatCost(row.usdEquivalent)}${partial}`;
  }
  return `Estimated USD, not a bill${partial}`;
}
</script>

<template>
  <SectionPanel title="Cost by Source" class="mb-4">
    <table class="data-table source-cost-table" aria-label="Cost by session source">
      <thead>
        <tr>
          <th scope="col">Source</th>
          <th scope="col" class="num-cell">Sessions</th>
          <th scope="col" class="num-cell">Tokens</th>
          <th scope="col" class="num-cell">Cost</th>
          <th scope="col">Basis</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.source" :data-source="row.source">
          <td>
            <span class="source-cost-name">
              <SourceLogo :source="row.source" />
              {{ sourceLabel(row.source) }}
            </span>
          </td>
          <td class="num-cell">{{ formatNumberFull(row.sessions) }}</td>
          <td class="num-cell">{{ formatNumber(row.tokens) }}</td>
          <td class="num-cell source-cost-value">{{ costText(row) }}</td>
          <td class="source-cost-basis">{{ basisText(row) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="source-cost-note">
      Each source keeps its own billing unit, so these costs are not added together.
    </p>
  </SectionPanel>
</template>

<style scoped>
.source-cost-table {
  width: 100%;
}

.source-cost-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.num-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.source-cost-value {
  font-weight: 600;
  color: var(--text-primary);
}

.source-cost-basis {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.source-cost-note {
  margin: 0;
  padding: 8px 12px 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
</style>
