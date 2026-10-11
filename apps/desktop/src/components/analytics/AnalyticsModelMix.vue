<script setup lang="ts">
/**
 * Which models did the work: one strip of every model's share of tokens,
 * then the biggest with their tokens and cost in their source's unit.
 */
import { formatNumber, formatPercent } from "@tracepilot/types";
import { Tooltip } from "@tracepilot/ui";
import { ArrowRight } from "lucide-vue-next";
import { computed } from "vue";
import { useRouter } from "vue-router";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { formatShare, SOURCE_COLORS } from "@/utils/analyticsDashboard";
import type { ModelRow } from "@/utils/analyticsSummary";

const props = defineProps<{ models: ModelRow[] }>();

const router = useRouter();
const SHOWN = 6;

const top = computed(() => props.models.slice(0, SHOWN));
const rest = computed(() => props.models.slice(SHOWN));
const maxTokens = computed(() => Math.max(1, props.models[0]?.tokens ?? 1));
const multiSource = computed(() => new Set(props.models.map((m) => m.source)).size > 1);

function cacheHit(model: ModelRow): string {
  const input = model.composition.input;
  return input
    ? `${formatPercent((model.composition.cacheRead / input) * 100)} cache hit`
    : "no input";
}

function openModels() {
  pushRoute(router, ROUTE_NAMES.modelComparison);
}
</script>

<template>
  <OverviewPanel title="Model mix" data-testid="analytics-model-mix">
    <template #aside>
      <span v-if="models.length">{{ models.length }} model{{ models.length === 1 ? "" : "s" }}</span>
      <button type="button" class="ad-link" @click="openModels">
        Compare models <ArrowRight :size="12" aria-hidden="true" />
      </button>
    </template>

    <template v-if="models.length">
      <div class="ad-meter ad-meter--lg model-mix__strip" aria-hidden="true">
        <i
          v-for="model in models"
          :key="model.key"
          :title="`${model.label}: ${formatNumber(model.tokens)} tokens · ${formatShare(model.share)}`"
          :style="{ width: `${model.share}%`, background: model.color }"
          data-reveal="grow-x"
        />
      </div>
      <div class="ad-rows" role="table" aria-label="Models by share of tokens">
        <div class="ad-rowh model-mix__grid" role="row">
          <span role="columnheader">Model</span>
          <span role="columnheader">Share of tokens</span>
          <span role="columnheader" class="ad-num">%</span>
          <span role="columnheader" class="ad-num">Tokens</span>
          <span role="columnheader" class="ad-num">Cost</span>
        </div>
        <Tooltip
          v-for="model in top"
          :key="model.key"
          :text="`${model.label}: ${formatNumber(model.requests)} requests · ${cacheHit(model)}`"
        >
          <div class="ad-row model-mix__grid" role="row">
            <span class="ad-row__name" role="cell">
              <span
                v-if="multiSource"
                class="ad-source"
                :style="{ color: SOURCE_COLORS[model.source] }"
              ><SourceLogo :source="model.source" :size="12" /></span>
              <i v-else class="ad-sw" :style="{ background: model.color }" />
              <span>{{ model.label }}</span>
            </span>
            <span class="ad-track" role="cell" aria-hidden="true">
              <i
                :style="{ width: `${Math.max(0.5, (model.tokens / maxTokens) * 100)}%`, background: model.color }"
                data-reveal="grow-x"
              />
            </span>
            <span class="ad-num" role="cell">{{ formatShare(model.share) }}</span>
            <span class="ad-num ad-num--muted" role="cell">{{ formatNumber(model.tokens) }}</span>
            <span class="ad-num ad-num--muted" role="cell">
              {{ model.costText }}<span v-if="model.partial" class="ad-partial" title="Partly priced">*</span>
            </span>
          </div>
        </Tooltip>
        <div v-if="rest.length" class="ad-row model-mix__grid" role="row">
          <span class="ad-row__name ad-num--muted" role="cell">
            <i class="ad-sw" :style="{ background: 'var(--neutral-emphasis)' }" />
            <span>{{ rest.length }} more</span>
          </span>
          <span role="cell" />
          <span class="ad-num" role="cell">{{ formatShare(rest.reduce((sum, m) => sum + m.share, 0)) }}</span>
          <span class="ad-num ad-num--muted" role="cell">
            {{ formatNumber(rest.reduce((sum, m) => sum + m.tokens, 0)) }}
          </span>
          <span role="cell" />
        </div>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No model usage</b>
      No model calls were recorded in this range.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.model-mix__strip {
  margin-bottom: 10px;
}

.model-mix__grid {
  grid-template-columns: minmax(0, 1.6fr) minmax(48px, 1.1fr) 44px 52px 76px;
}
</style>
