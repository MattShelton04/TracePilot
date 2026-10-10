<script setup lang="ts">
import {
  type AiCreditUsage,
  type ModelMetricDetail,
  type SessionSegment,
  type ShutdownMetrics,
} from "@tracepilot/types";
import {
  Badge,
  formatAiCredits,
  formatCost,
  formatDuration,
  formatNumber,
  formatShortDate,
  formatTime,
  SectionPanel,
} from "@tracepilot/ui";
import { computed } from "vue";
import { useClientPager } from "@/composables/useClientPager";
import { shutdownAiCreditUsage } from "@/composables/useSessionMetrics";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { usePreferencesStore } from "@/stores/preferences";
import { modelTokenBreakdown, shutdownTokenBreakdown } from "@/utils/metricsTokenBreakdown";

const props = defineProps<{
  metrics: ShutdownMetrics;
  /** Show only recorded AI Credits, never GitHub-rate estimates. */
  observedOnly?: boolean;
}>();

const prefs = usePreferencesStore();
const modelName = useSessionModelName();
const segments = computed(() => props.metrics.sessionSegments ?? []);
const PAGE_SIZE = 6;
const { page, pageCount, pageRows } = useClientPager(segments, PAGE_SIZE);
// Price and sort only the visible page, once per data/pricing change. Previously
// template expressions repeated this work several times for every shutdown.
const visibleSegments = computed(() =>
  pageRows.value.map((seg, offset) => ({
    seg,
    index: page.value * PAGE_SIZE + offset,
    duration: segmentDurationMs(seg),
    tokens: shutdownTokenBreakdown(seg).total,
    credits: shutdownAiCreditUsage(seg, prefs, props.observedOnly),
    models: sortedSegmentModels(seg.modelMetrics).map(([name, metric]) => ({
      name,
      tokens: modelTokenBreakdown(metric).total,
      credits: shutdownAiCreditUsage(
        { totalNanoAiu: metric.totalNanoAiu, modelMetrics: { [name]: metric } },
        prefs,
        props.observedOnly,
      ),
    })),
  })),
);

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

function sourceLabel(source: AiCreditUsage["source"]): string {
  if (source === "observed") return "Observed AI Credits";
  if (source === "estimated-token-usage") return "Estimated AI Credits from GitHub token rates";
  if (source === "estimated-direct-api") return "Estimated AI Credits from direct API rates";
  return "AI Credits unavailable";
}
</script>

<template>
  <SectionPanel v-if="metrics.sessionSegments?.length" title="Session Activity" class="mb-6">
    <nav v-if="pageCount > 1" class="activity-pagination" aria-label="Session activity pages">
      <span class="text-xs text-[var(--text-tertiary)]">{{ page * PAGE_SIZE + 1 }}–{{ Math.min((page + 1) * PAGE_SIZE, segments.length) }} of {{ segments.length }} activities</span>
      <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous activities</button>
      <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">Next activities</button>
      <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page = pageCount - 1">Latest activities</button>
    </nav>
    <div class="activity-horizontal" tabindex="0" role="region" aria-label="Session activity">
      <div
        v-for="{ seg, index: idx, duration, tokens, credits, models } in visibleSegments"
        :key="idx"
        class="activity-tile"
      >
        <div class="activity-tile-header">
          <div class="flex flex-col">
            <span class="activity-index">Activity #{{ idx + 1 }}</span>
            <span class="activity-date">{{ formatShortDate(seg.startTimestamp) }}</span>
            <span class="activity-timestamp">
              {{ formatTime(seg.startTimestamp) }} → {{ formatTime(seg.endTimestamp) }}
              <span v-if="duration" class="activity-duration">· {{ formatDuration(duration) }}</span>
            </span>
          </div>
          <Badge v-if="idx === metrics.sessionSegments.length - 1" variant="success" size="sm">Latest</Badge>
        </div>

        <div class="activity-hero" :class="{ 'activity-hero--empty': tokens === 0 }">
          <div class="hero-stats">
            <div class="hero-main">
              <span class="hero-val" :title="tokens == null ? 'Token total unavailable' : undefined">{{ tokens == null ? '—' : formatNumber(tokens) }}</span>
              <span class="hero-unit">tokens</span>
            </div>
          </div>
        </div>

        <div v-if="models.length" class="activity-details">
          <div
            v-for="{ name, tokens: modelTokens, credits: modelCredits } in models"
            :key="name"
            class="model-row"
          >
            <div class="row-main">
              <span class="model-name" :title="name">{{ modelName(name) }}</span>
              <span class="model-tokens">{{ modelTokens == null ? '—' : formatNumber(modelTokens) }} <small>tokens</small></span>
            </div>
            <div class="row-costs">
              <span
                class="cost-pill blue-text"
                :title="sourceLabel(modelCredits.source)"
              >
                {{ formatAiCredits(modelCredits.credits) }}
              </span>
              <span
                v-if="modelCredits.usdEquivalent != null"
                class="cost-equivalent"
              >
                {{ formatCost(modelCredits.usdEquivalent) }}
              </span>
            </div>
          </div>
        </div>

        <div class="activity-tile-costs">
          <span class="cost-pill blue-text" :title="sourceLabel(credits.source)">
            {{ formatAiCredits(credits.credits) }}
          </span>
          <span v-if="credits.usdEquivalent != null" class="cost-equivalent">
            {{ formatCost(credits.usdEquivalent) }}
          </span>
        </div>
        <div class="activity-tile-footer">
          <div class="footer-metric">
            <span class="label">API Time</span>
            <span class="val">{{ formatDuration(seg.apiDurationMs) }}</span>
          </div>
          <div class="footer-metric">
            <span class="label">Reqs</span>
            <span class="val">{{ formatNumber(seg.totalRequests) }}</span>
          </div>
          <div
            v-if="credits.source === 'unavailable' && seg.premiumRequests > 0"
            class="footer-metric"
            title="Legacy sessions only; premium requests are not converted to AIC"
          >
            <span class="label">Legacy Premium</span>
            <span class="val premium-val">{{ seg.premiumRequests.toFixed(1) }}</span>
          </div>
        </div>
      </div>
    </div>
  </SectionPanel>
</template>

<style scoped>
.activity-pagination {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.activity-horizontal {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 8px 8px 16px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
  margin: 0 -8px;
  justify-content: safe center;
}

.activity-horizontal::-webkit-scrollbar {
  height: 4px;
}

.activity-horizontal::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 10px;
}

.activity-tile {
  flex: 0 0 280px;
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}

.activity-tile:hover {
  border-color: var(--accent-fg);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.activity-tile-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.activity-index {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--accent-fg);
  letter-spacing: 0.05em;
}

.activity-date {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 2px;
}

.activity-timestamp {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
}

.activity-hero {
  background: var(--canvas-inset);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin-bottom: 12px;
  border-left: 2px solid var(--accent-fg);
  display: flex;
  align-items: center;
  min-height: 40px;
}

.activity-hero--empty {
  border-left-color: var(--border-subtle);
  background: var(--canvas-default);
  opacity: 0.5;
}

.hero-main {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.hero-val {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
}

.hero-unit {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.activity-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-grow: 1;
  margin-bottom: 12px;
  max-height: 240px;
  overflow-y: auto;
}

.model-row {
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-row--premium {
  border-left: 2px solid var(--warning-fg);
  background: var(--warning-subtle);
}

.row-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.model-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tokens {
  font-size: 0.6875rem;
  font-family: var(--font-mono, monospace);
  color: var(--text-tertiary);
}

.model-tokens small {
  font-size: 0.625rem;
  opacity: 0.7;
}

.row-costs {
  display: flex;
  gap: 6px;
}

.cost-pill {
  font-size: 0.6875rem;
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  background: var(--canvas-inset);
  padding: 1px 6px;
  border-radius: 3px;
}

.cost-equivalent {
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
  font-size: 0.6875rem;
}

.activity-tile-costs {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.activity-tile-footer {
  display: flex;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.footer-metric {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.footer-metric .label {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  text-transform: uppercase;
}

.footer-metric .val {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.premium-val {
  color: var(--warning-fg) !important;
}

.activity-duration {
  color: var(--text-placeholder);
  font-weight: 400;
}

.amber-text { color: var(--warning-fg); }
.emerald-text { color: var(--success-fg); }
.blue-text { color: var(--accent-fg); }
</style>
