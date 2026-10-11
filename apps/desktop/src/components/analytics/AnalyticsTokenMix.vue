<script setup lang="ts">
/**
 * What the tokens were: cache reads, cache writes, fresh input and output,
 * across the range and for each of the biggest models. Most of a modern
 * agent's tokens are cache reads, which is why the token count reads large.
 */
import { formatNumber, formatPercent } from "@tracepilot/types";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import { formatShare, SOURCE_COLORS } from "@/utils/analyticsDashboard";
import { COMPOSITION, type ModelRow, type TokenComposition } from "@/utils/analyticsSummary";

const props = defineProps<{ composition: TokenComposition; models: ModelRow[] }>();

const parts = computed(() =>
  COMPOSITION.filter((part) => props.composition[part.key] > 0).map((part) => ({
    ...part,
    value: props.composition[part.key],
    share: (props.composition[part.key] / props.composition.total) * 100,
  })),
);

const rows = computed(() =>
  props.models
    .filter((model) => model.tokens > 0)
    .slice(0, 6)
    .map((model) => ({
      ...model,
      parts: COMPOSITION.filter((part) => model.composition[part.key] > 0).map((part) => ({
        ...part,
        width: (model.composition[part.key] / model.tokens) * 100,
        title: `${model.label}: ${part.label} ${formatNumber(model.composition[part.key])} · ${formatPercent((model.composition[part.key] / model.tokens) * 100)}`,
      })),
    })),
);
</script>

<template>
  <OverviewPanel title="What the tokens were" data-testid="analytics-token-mix">
    <template #aside>
      <span v-if="composition.total">{{ formatNumber(composition.total) }} tokens</span>
    </template>

    <template v-if="composition.total">
      <div class="ad-meter ad-meter--lg token-mix__bar" aria-hidden="true">
        <i
          v-for="part in parts"
          :key="part.key"
          :title="`${part.label}: ${formatNumber(part.value)}`"
          :style="{ width: `${part.share}%`, background: part.color }"
          data-reveal="grow-x"
        />
      </div>
      <div class="ad-legend token-mix__legend">
        <span v-for="part in parts" :key="part.key">
          <i class="ad-sw" :style="{ background: part.color }" />{{ part.label }}
          <b>{{ formatNumber(part.value) }}</b>{{ formatShare(part.share) }}
        </span>
      </div>
      <div class="ad-rows" role="table" aria-label="Token kinds by model">
        <div class="ad-rowh token-mix__grid" role="row">
          <span role="columnheader">Model</span>
          <span role="columnheader">Cache reads · writes · fresh · output</span>
          <span role="columnheader" class="ad-num">Tokens</span>
        </div>
        <div v-for="row in rows" :key="row.key" class="ad-row token-mix__grid" role="row">
          <span class="ad-row__name" role="cell">
            <span class="ad-source" :style="{ color: SOURCE_COLORS[row.source] }">
              <SourceLogo :source="row.source" :size="12" />
            </span>
            <span>{{ row.label }}</span>
          </span>
          <span class="ad-track ad-track--tall" role="cell">
            <i
              v-for="part in row.parts"
              :key="part.key"
              :title="part.title"
              :style="{ width: `${part.width}%`, background: part.color }"
            />
          </span>
          <span class="ad-num ad-num--muted" role="cell">{{ formatNumber(row.tokens) }}</span>
        </div>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No tokens</b>
      No model usage in this range.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.token-mix__bar {
  height: 14px;
}

.token-mix__legend {
  margin: 8px 0 10px;
}

.token-mix__legend b {
  margin-right: 2px;
}

.token-mix__grid {
  grid-template-columns: minmax(0, 1.3fr) minmax(80px, 2fr) 52px;
}

.token-mix__grid .ad-track > i {
  min-width: 2px;
}
</style>
