<script setup lang="ts">
/**
 * Where the session's money went: the total and its basis, then the split
 * by token kind and by model. Cache reads are most of the tokens but a
 * fraction of the cost, and cache writes the reverse, so the split is shown
 * in dollars rather than tokens.
 */
import { formatAiCredits } from "@tracepilot/types";
import { Badge } from "@tracepilot/ui";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import type { MetricsCostSummary } from "@/composables/useMetricsCost";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { COMPOSITION } from "@/utils/analyticsSummary";
import { type CostSplit, formatShare } from "@/utils/metricsView";
import { formatUsd } from "@/utils/sourceCost";

const props = defineProps<{
  cost: MetricsCostSummary;
  split: CostSplit | null;
  /** Models with their cost in USD (null when unknown), most expensive first. */
  models: Array<{ name: string; usd: number | null; estimated: boolean; color?: string }>;
  /** True for sources billed in AI Credits. */
  credits: boolean;
}>();

const modelName = useSessionModelName();
const COST_LABELS: Record<string, string> = {
  cacheRead: "Cache reads",
  cacheWrite: "Cache writes",
  fresh: "Fresh input",
  output: "Output",
};

const kinds = computed(() => {
  const total = props.cost.usd;
  // A zero total has nothing to split.
  if (!props.split || !total) return [];
  return COMPOSITION.map((part) => ({
    ...part,
    label: COST_LABELS[part.key],
    share: props.split?.byKind[part.key] ?? 0,
    usd: (props.split?.byKind[part.key] ?? 0) * total,
  })).filter((part) => part.share > 0);
});
const maxModel = computed(() => Math.max(0, ...props.models.map((m) => m.usd ?? 0)));
const mixed = computed(
  () => props.models.some((m) => m.estimated) && props.models.some((m) => !m.estimated),
);
const unpriced = computed(() => props.split?.unpriced.map(modelName) ?? []);
</script>

<template>
  <OverviewPanel title="Cost" data-testid="metrics-cost">
    <template #aside>
      <Badge :variant="cost.estimate ? 'neutral' : 'success'">{{ cost.basis }}</Badge>
      <Badge v-if="cost.lowerBound" variant="warning">Lower bound</Badge>
      <Badge v-else-if="cost.partial" variant="warning">Partial</Badge>
    </template>

    <div class="cost">
    <div class="cost__head">
      <span class="cost__value kpi__value-num">{{ cost.value }}</span>
      <span v-if="credits && cost.credits" class="cost__unit">{{ cost.credits }} · $0.01 each</span>
      <span v-else-if="cost.usd != null" class="cost__unit">USD at API rates</span>
    </div>

    <template v-if="kinds.length">
      <div class="ad-meter ad-meter--lg cost__bar" aria-hidden="true">
        <i v-for="part in kinds" :key="part.key" :title="`${part.label}: ${formatUsd(part.usd)} · ${formatShare(part.share * 100)}`" :style="{ width: `${part.share * 100}%`, background: part.color }" data-reveal="grow-x" />
      </div>
      <div class="ad-legend">
        <span v-for="part in kinds" :key="part.key">
          <i class="ad-sw" :style="{ background: part.color }" />{{ part.label }} <b>{{ formatUsd(part.usd) }}</b><span class="cost__pct">{{ formatShare(part.share * 100) }}</span>
        </span>
      </div>
    </template>

    <div v-if="models.length > 1" class="ad-rows cost__models" role="table" aria-label="Cost by model">
      <div class="ad-rowh cost__grid" role="row">
        <span role="columnheader">Model</span>
        <span role="columnheader">Share of cost</span>
        <span role="columnheader" class="ad-num">USD</span>
        <span v-if="credits" role="columnheader" class="ad-num">AI Credits</span>
      </div>
      <div v-for="model in models" :key="model.name" class="ad-row cost__grid" role="row">
        <span class="ad-row__name" role="cell"><i class="ad-sw" :style="{ background: model.color ?? 'var(--chart-primary)' }" /><span :title="model.name">{{ modelName(model.name) }}</span></span>
        <span class="ad-track" role="cell">
          <i v-if="model.usd != null && maxModel > 0" :style="{ width: `${(model.usd / maxModel) * 100}%`, background: model.color ?? 'var(--chart-primary)' }" data-reveal="grow-x" />
        </span>
        <span class="ad-num" role="cell">
          {{ model.usd == null ? "—" : formatUsd(model.usd) }}<span v-if="mixed && model.estimated" class="cost__est" title="No AI Credits were recorded for this model, so its cost is estimated from token rates">est.</span>
        </span>
        <span v-if="credits" class="ad-num ad-num--muted" role="cell">{{ model.usd == null ? "—" : formatAiCredits(model.usd * 100) }}</span>
      </div>
    </div>

    <p v-if="cost.unattributed" class="ad-note" data-testid="unattributed-credits">
      {{ cost.unattributed }} not yet attributed to a model.
    </p>
    <p class="ad-note">
      {{ cost.coverage }}
      <template v-if="kinds.length"> The split by kind{{ models.length > 1 && !credits ? " and model" : "" }} is estimated from model prices.</template>
      <template v-if="mixed"> Models marked est. had no AI Credits recorded, so their cost is estimated from GitHub's token rates and isn't in the total.</template>
      <template v-if="unpriced.length"> No prices for {{ unpriced.join(", ") }}, so {{ unpriced.length === 1 ? "it is" : "they are" }} left out of the split.</template>
    </p>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.cost {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.cost__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.cost__value {
  font: 500 22px / 28px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.cost__unit {
  font: 12px / 16px var(--font-mono);
  color: var(--text-tertiary);
}

.cost__bar {
  height: 12px;
}

.cost__pct {
  font: 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
}

.cost__models {
  margin-top: 4px;
}

.cost__grid {
  grid-template-columns: minmax(0, 1.2fr) minmax(60px, 2fr) 76px 92px;
}

.cost__est {
  margin-left: 4px;
  font-size: 10px;
  color: var(--warning-fg);
}

@container (max-width: 600px) {
  .cost__grid {
    grid-template-columns: minmax(0, 1fr) 76px 84px;
  }

  .cost__grid > :nth-child(2) {
    display: none;
  }
}
</style>
