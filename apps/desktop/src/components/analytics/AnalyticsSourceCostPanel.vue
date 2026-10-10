<script setup lang="ts">
import { sourceLabel } from "@tracepilot/types";
import {
  formatAiCredits,
  formatCost,
  formatNumber,
  formatNumberFull,
  SectionPanel,
} from "@tracepilot/ui";
import { computed } from "vue";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import { combinedCostTotal, type SourceCostRow } from "@/utils/analyticsCostSeries";

const props = defineProps<{ rows: SourceCostRow[] }>();

const total = computed(() => ({
  ...combinedCostTotal(props.rows),
  sessions: props.rows.reduce((sum, row) => sum + row.sessions, 0),
  tokens: props.rows.reduce((sum, row) => sum + row.tokens, 0),
}));

function costText(usd: number | null): string {
  return usd == null ? "Unpriced" : formatCost(usd);
}

function basisText(row: SourceCostRow): string {
  const partial = row.partial ? " · partial" : "";
  if (row.unit === "aic") {
    return row.amount == null
      ? `AI Credits${partial}`
      : `${formatAiCredits(row.amount)} at $0.01${partial}`;
  }
  return `API-equivalent rates${partial}`;
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
          <th scope="col" class="num-cell">Cost (USD)</th>
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
          <td class="num-cell source-cost-value">{{ costText(row.usdEquivalent) }}</td>
          <td class="source-cost-basis">{{ basisText(row) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr data-source="total">
          <td>All sources</td>
          <td class="num-cell">{{ formatNumberFull(total.sessions) }}</td>
          <td class="num-cell">{{ formatNumber(total.tokens) }}</td>
          <td class="num-cell source-cost-value">{{ costText(total.usd) }}</td>
          <td class="source-cost-basis">{{ total.partial ? 'Partial' : '' }}</td>
        </tr>
      </tfoot>
    </table>
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

.source-cost-table tfoot td {
  border-bottom: 0;
  font-weight: 600;
}
</style>
