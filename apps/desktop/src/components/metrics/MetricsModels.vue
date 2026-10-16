<script setup lang="ts">
/**
 * Which models did the work: a strip of every model's share of tokens, then
 * a ranked row per model with input, output, reasoning, requests, cache hit
 * and cost. A row opens to its exact token kinds.
 */
import { formatNumber, formatNumberFull, formatPercent } from "@tracepilot/types";
import { ArrowRight, ChevronRight } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import type { MetricsModelEntry } from "@/composables/useMetricsTabData";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { COMPOSITION } from "@/utils/analyticsSummary";
import { formatShare, MODEL_COLORS } from "@/utils/metricsView";
import { formatUsd } from "@/utils/sourceCost";

const props = defineProps<{
  models: MetricsModelEntry[];
  /** A model's cost in USD; null when unknown. */
  costOf: (name: string) => number | null;
  /** True when some models' cost is estimated and others observed. */
  estimatedOf?: (name: string) => boolean;
}>();

const modelName = useSessionModelName();
const router = useRouter();
const open = ref<string | null>(null);

const total = computed(() => props.models.reduce((n, m) => n + (m.tokens.total ?? 0), 0));
const hasReasoning = computed(() => props.models.some((m) => m.tokens.reasoning != null));
const rows = computed(() =>
  props.models.map((m, index) => {
    const t = m.tokens;
    const fresh = t.uncached ?? (t.notCached != null ? t.notCached - (t.cacheWrite ?? 0) : null);
    const kinds = { cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, fresh, output: t.output };
    return {
      ...m,
      label: modelName(m.name),
      color: MODEL_COLORS[index % MODEL_COLORS.length],
      share: total.value > 0 && t.total != null ? (t.total / total.value) * 100 : null,
      hit: t.cacheRatio == null ? null : t.cacheRatio * 100,
      usd: props.costOf(m.name),
      estimated: props.estimatedOf?.(m.name) ?? false,
      perRequest: m.requests && t.total != null ? Math.round(t.total / m.requests) : null,
      kinds: t.total
        ? COMPOSITION.filter((part) => (kinds[part.key] ?? 0) > 0).map((part) => ({
            ...part,
            value: kinds[part.key] ?? 0,
            width: ((kinds[part.key] ?? 0) / (t.total as number)) * 100,
          }))
        : [],
    };
  }),
);
const fmt = (value: number | null | undefined) => (value == null ? "—" : formatNumber(value));
function toggle(name: string) {
  open.value = open.value === name ? null : name;
}
</script>

<template>
  <OverviewPanel title="Models" data-testid="metrics-models">
    <template #aside>
      <span>{{ models.length }} model{{ models.length === 1 ? "" : "s" }}</span>
      <button type="button" class="ad-link" @click="pushRoute(router, ROUTE_NAMES.modelComparison)">
        Compare models <ArrowRight :size="12" aria-hidden="true" />
      </button>
    </template>

    <div class="models">
      <div v-if="rows.length > 1 && total > 0" class="ad-meter ad-meter--lg" aria-hidden="true">
        <i v-for="row in rows" :key="row.name" :title="`${row.label}: ${fmt(row.tokens.total)} tokens · ${formatShare(row.share ?? 0)}`" :style="{ width: `${row.share ?? 0}%`, background: row.color }" data-reveal="grow-x" />
      </div>

      <div class="ad-rows" role="table" aria-label="Usage by model">
        <div class="ad-rowh models__grid" :class="{ 'models__grid--reasoning': hasReasoning }" role="row">
          <span role="columnheader">Model</span>
          <span role="columnheader" class="models__share">Share of tokens</span>
          <span role="columnheader" class="ad-num">Input</span>
          <span role="columnheader" class="ad-num">Output</span>
          <span v-if="hasReasoning" role="columnheader" class="ad-num models__reasoning">Reasoning</span>
          <span role="columnheader" class="ad-num">Requests</span>
          <span role="columnheader" class="ad-num models__hit">Cache hit</span>
          <span role="columnheader" class="ad-num">Cost</span>
        </div>
        <template v-for="row in rows" :key="row.name">
          <button
            type="button"
            class="ad-row models__grid"
            :class="{ 'models__grid--reasoning': hasReasoning, 'is-open': open === row.name }"
            role="row"
            :aria-expanded="open === row.name"
            :title="row.name"
            @click="toggle(row.name)"
          >
            <span class="ad-row__name" role="cell">
              <ChevronRight :size="12" class="models__chev" aria-hidden="true" />
              <i class="ad-sw" :style="{ background: row.color }" />
              <span>{{ row.label }}</span>
            </span>
            <span class="models__share models__bar" role="cell">
              <span class="ad-track"><i :style="{ width: `${row.share ?? 0}%`, background: row.color }" data-reveal="grow-x" /></span>
              <em>{{ row.share == null ? "—" : formatShare(row.share) }}</em>
            </span>
            <span class="ad-num" role="cell">{{ fmt(row.tokens.input) }}</span>
            <span class="ad-num" role="cell">{{ fmt(row.tokens.output) }}</span>
            <span v-if="hasReasoning" class="ad-num ad-num--muted models__reasoning" role="cell">{{ fmt(row.tokens.reasoning) }}</span>
            <span class="ad-num" role="cell">{{ row.requests == null ? "—" : formatNumberFull(row.requests) }}</span>
            <span class="ad-num ad-num--muted models__hit" role="cell">{{ row.hit == null ? "—" : formatPercent(row.hit) }}</span>
            <span class="ad-num" role="cell">
              {{ row.usd == null ? "—" : formatUsd(row.usd) }}<span v-if="row.estimated" class="models__est" title="No AI Credits were recorded for this model, so its cost is estimated from token rates">est.</span>
            </span>
          </button>
          <div v-if="open === row.name" class="models__detail" data-testid="metrics-model-detail">
            <div v-if="row.kinds.length" class="ad-meter" aria-hidden="true">
              <i v-for="part in row.kinds" :key="part.key" :style="{ width: `${part.width}%`, background: part.color }" />
            </div>
            <dl class="models__facts">
              <div v-for="part in row.kinds" :key="part.key">
                <dt><i class="ad-sw" :style="{ background: part.color }" />{{ part.label }}</dt>
                <dd>{{ formatNumberFull(part.value) }}</dd>
              </div>
              <div><dt>Reasoning</dt><dd>{{ row.tokens.reasoning == null ? "Not recorded" : formatNumberFull(row.tokens.reasoning) }}</dd></div>
              <div><dt>Total</dt><dd>{{ row.tokens.total == null ? "—" : formatNumberFull(row.tokens.total) }}</dd></div>
              <div><dt>Per request</dt><dd>{{ row.perRequest == null ? "—" : formatNumber(row.perRequest) }}</dd></div>
            </dl>
            <p v-if="row.tokens.inconsistent" class="ad-note models__warn">Recorded categories do not reconcile.</p>
          </div>
        </template>
      </div>
      <p class="ad-note">Input counts cache reads, cache writes and fresh input. Reasoning is counted within output.</p>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.models {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.models__grid {
  grid-template-columns: minmax(120px, 1.4fr) minmax(80px, 1.4fr) 64px 64px 64px 60px 72px;
}

.models__grid--reasoning {
  grid-template-columns: minmax(120px, 1.4fr) minmax(80px, 1.4fr) 64px 64px 72px 64px 60px 72px;
}

.models__bar {
  display: grid;
  grid-template-columns: 1fr 44px;
  gap: 8px;
  align-items: center;
}

.models__bar em {
  font: normal 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
  text-align: right;
}

.models__chev {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform var(--duration-fast) var(--ease-out);
}

.is-open .models__chev {
  transform: rotate(90deg);
}

.models__est {
  margin-left: 3px;
  font-size: 10px;
  color: var(--warning-fg);
}

/* Indented to the model name, past the chevron. */
.models__detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 2px 0 6px;
  padding: 12px 12px 12px 24px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset);
}

/* Label over value, so every figure starts on the same edge. */
.models__facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px 16px;
  margin: 0;
}

.models__facts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.models__facts dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.models__facts dd {
  margin: 0;
  font: 500 12px / 16px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  white-space: nowrap;
}

.models__warn {
  color: var(--attention-fg);
}

/* Narrow: drop the share bar, then reasoning and cache hit. */
@container (max-width: 860px) {
  .models__grid,
  .models__grid--reasoning {
    grid-template-columns: minmax(110px, 1fr) 60px 60px 60px 72px;
  }

  .models__share,
  .models__reasoning,
  .models__hit {
    display: none;
  }
}
</style>
