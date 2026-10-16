<script setup lang="ts">
/**
 * One tile per run (each Copilot shutdown): when it ran, its tokens and
 * cost, how the tokens divided between models, and its model time and
 * requests. Long sessions page six runs at a time, starting at the latest.
 */
import type {
  AiCreditUsage,
  ModelMetricDetail,
  SessionSegment,
  ShutdownMetrics,
} from "@tracepilot/types";
import {
  Badge,
  formatAiCredits,
  formatAiCreditsUsd,
  formatDuration,
  formatNumber,
  formatShortDate,
  formatTime,
} from "@tracepilot/ui";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useClientPager } from "@/composables/useClientPager";
import { shutdownAiCreditUsage } from "@/composables/useSessionMetrics";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { usePreferencesStore } from "@/stores/preferences";
import { modelTokenBreakdown, shutdownTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import { MODEL_COLORS } from "@/utils/metricsView";

const props = defineProps<{
  metrics: ShutdownMetrics;
  /** Show only recorded AI Credits, never GitHub-rate estimates. */
  observedOnly?: boolean;
  /** Session models in rank order, so a model keeps its colour from the Models panel. */
  modelOrder?: readonly string[];
}>();

const prefs = usePreferencesStore();
const modelName = useSessionModelName();
const segments = computed(() => props.metrics.sessionSegments ?? []);
const PAGE_SIZE = 6;
const { page, pageCount, pageRows } = useClientPager(segments, PAGE_SIZE);
// The latest runs matter most, so long sessions open on the last page.
page.value = pageCount.value - 1;

function colorOf(name: string): string {
  const index = props.modelOrder?.indexOf(name) ?? -1;
  return index >= 0 ? MODEL_COLORS[index % MODEL_COLORS.length] : "var(--text-tertiary)";
}

// Price only the visible page, once per data or pricing change.
const visibleSegments = computed(() =>
  pageRows.value.map((seg, offset) => {
    const tokens = shutdownTokenBreakdown(seg).total;
    const credits = shutdownAiCreditUsage(seg, prefs, props.observedOnly);
    const models = sortedSegmentModels(seg.modelMetrics).map(([name, metric]) => ({
      name,
      color: colorOf(name),
      tokens: modelTokenBreakdown(metric).total,
      credits: shutdownAiCreditUsage(
        { totalNanoAiu: metric.totalNanoAiu, modelMetrics: { [name]: metric } },
        prefs,
        props.observedOnly,
      ),
    }));
    const known = models.reduce((n, m) => n + (m.tokens ?? 0), 0);
    return {
      seg,
      index: page.value * PAGE_SIZE + offset,
      duration: segmentDurationMs(seg),
      tokens,
      credits,
      models,
      // With one model and a run total, the model's cost would only repeat it.
      modelCosts: models.length > 1 || credits.credits == null,
      shares:
        known > 0 ? models.map((m) => ({ ...m, share: ((m.tokens ?? 0) / known) * 100 })) : [],
    };
  }),
);
const firstShown = computed(() => page.value * PAGE_SIZE + 1);
const lastShown = computed(() => Math.min((page.value + 1) * PAGE_SIZE, segments.value.length));

function sortedSegmentModels(
  modelMetrics?: Record<string, ModelMetricDetail> | null,
): [string, ModelMetricDetail][] {
  if (!modelMetrics) return [];
  return Object.entries(modelMetrics).sort(([, a], [, b]) => {
    const costDiff = (b.requests?.cost ?? 0) - (a.requests?.cost ?? 0);
    if (costDiff !== 0) return costDiff;
    const tokensA = modelTokenBreakdown(a).total ?? -1;
    const tokensB = modelTokenBreakdown(b).total ?? -1;
    return tokensB - tokensA;
  });
}

function segmentDurationMs(seg: SessionSegment): number | null {
  if (!seg.startTimestamp || !seg.endTimestamp) return null;
  return new Date(seg.endTimestamp).getTime() - new Date(seg.startTimestamp).getTime();
}

function sameDay(seg: SessionSegment): boolean {
  if (!seg.startTimestamp || !seg.endTimestamp) return true;
  return new Date(seg.startTimestamp).toDateString() === new Date(seg.endTimestamp).toDateString();
}

function sourceLabel(source: AiCreditUsage["source"]): string {
  if (source === "observed") return "Observed AI Credits";
  if (source === "estimated-token-usage") return "Estimated AI Credits from GitHub token rates";
  if (source === "estimated-direct-api") return "Estimated AI Credits from direct API rates";
  return "AI Credits unavailable";
}
</script>

<template>
  <OverviewPanel v-if="segments.length" title="Runs" data-testid="metrics-runs">
    <template #aside>
      <span>{{ segments.length }} run{{ segments.length === 1 ? "" : "s" }} · one per shutdown</span>
      <nav v-if="pageCount > 1" class="runs__pager" aria-label="Run pages">
        <span class="runs__range">{{ firstShown }}–{{ lastShown }} of {{ segments.length }} runs</span>
        <button type="button" class="runs__page" :disabled="page === 0" aria-label="Earlier runs" @click="page--">
          <ChevronLeft :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="runs__page" :disabled="page + 1 >= pageCount" aria-label="Later runs" @click="page++">
          <ChevronRight :size="14" aria-hidden="true" />
        </button>
        <button v-if="page + 1 < pageCount" type="button" class="ad-link" @click="page = pageCount - 1">Latest</button>
      </nav>
    </template>
    <div class="runs" tabindex="0" role="region" aria-label="Runs">
      <article
        v-for="{ seg, index: idx, duration, tokens, credits, models, modelCosts, shares } in visibleSegments"
        :key="idx"
        class="activity-tile"
      >
        <header class="activity-tile__head">
          <span class="activity-index">Run {{ idx + 1 }}</span>
          <Badge v-if="idx === segments.length - 1" variant="success">Latest</Badge>
          <span class="activity-timestamp">
            {{ formatShortDate(seg.startTimestamp) }} · {{ formatTime(seg.startTimestamp) }} → <template v-if="!sameDay(seg)">{{ formatShortDate(seg.endTimestamp) }} · </template>{{ formatTime(seg.endTimestamp) }}<template v-if="duration"> · {{ formatDuration(duration) }}</template>
          </span>
        </header>

        <div class="activity-hero">
          <span class="hero-val" :class="{ 'hero-val--muted': !tokens }" :title="tokens == null ? 'Token total unavailable' : undefined">{{ tokens == null ? "—" : formatNumber(tokens) }}</span>
          <span class="hero-unit">tokens</span>
          <span class="activity-tile-costs" :title="sourceLabel(credits.source)">
            <span class="cost-pill" :class="{ 'cost-pill--estimated': credits.source !== 'observed' && credits.credits != null }">{{ formatAiCreditsUsd(credits.credits) }}</span>
            <span v-if="credits.credits != null" class="cost-equivalent">{{ formatAiCredits(credits.credits) }}</span>
          </span>
        </div>

        <div v-if="shares.length > 1" class="ad-meter" aria-hidden="true">
          <i v-for="m in shares" :key="m.name" :style="{ width: `${m.share}%`, background: m.color }" data-reveal="grow-x" />
        </div>

        <div v-if="models.length" class="activity-details">
          <div v-for="m in models" :key="m.name" class="model-row">
            <i class="ad-sw" :style="{ background: m.color }" />
            <span class="model-name" :title="m.name">{{ modelName(m.name) }}</span>
            <span class="model-tokens">{{ m.tokens == null ? "—" : formatNumber(m.tokens) }} <small>tokens</small></span>
            <span v-if="modelCosts" class="cost-pill" :title="sourceLabel(m.credits.source)">{{ formatAiCreditsUsd(m.credits.credits) }}</span>
            <span v-if="modelCosts && m.credits.credits != null" class="cost-equivalent">{{ formatAiCredits(m.credits.credits) }}</span>
          </div>
        </div>

        <dl class="activity-tile-footer">
          <div><dt>Model time</dt><dd>{{ formatDuration(seg.apiDurationMs) }}</dd></div>
          <div><dt>Requests</dt><dd>{{ formatNumber(seg.totalRequests) }}</dd></div>
          <div
            v-if="credits.source === 'unavailable' && seg.premiumRequests > 0"
            title="Legacy sessions only; premium requests are not converted to cost"
          >
            <dt>Legacy premium</dt><dd class="premium-val">{{ seg.premiumRequests.toFixed(1) }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.runs__pager {
  display: flex;
  align-items: center;
  gap: 4px;
}
.runs__range {
  margin-right: 4px;
  font-variant-numeric: tabular-nums;
}
.runs__page {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-secondary);
  cursor: pointer;
}
.runs__page:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--state-hover-overlay);
}
.runs__page:disabled {
  opacity: 0.4;
  cursor: default;
}
.runs__page:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 1px;
}
.runs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(250px, 1fr);
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
}
.runs:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.activity-tile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
}
.activity-tile__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
}
.activity-index {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.activity-timestamp {
  flex-basis: 100%;
  font: 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.activity-hero {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.hero-val {
  font: 600 20px / 26px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.hero-val--muted {
  color: var(--text-tertiary);
}
.hero-unit {
  font-size: 12px;
  color: var(--text-tertiary);
}
.activity-tile-costs {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin-left: auto;
  white-space: nowrap;
}
.cost-pill {
  font: 600 12px / 16px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.activity-hero .cost-pill {
  font-size: 13px;
}
.cost-pill--estimated::before {
  content: "≈ ";
  color: var(--text-tertiary);
  font-weight: 400;
}
.cost-equivalent {
  font: 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
}
.activity-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 168px;
  overflow-y: auto;
}
.model-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
}
.model-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.model-tokens {
  font: 11px / 16px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.model-tokens small {
  font-size: 10px;
}
.activity-tile-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: auto 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--border-muted);
}
.activity-tile-footer > div {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.activity-tile-footer dt {
  font-size: 11px;
  color: var(--text-tertiary);
}
.activity-tile-footer dd {
  margin: 0;
  font: 500 12px / 16px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.premium-val {
  color: var(--warning-fg);
}
</style>
