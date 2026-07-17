<script setup lang="ts">
import {
  type AiCreditUsage,
  type ModelMetricDetail,
  resolveAiCreditUsage,
  type SessionSegment,
  type ShutdownMetrics,
  sumTokenCosts,
} from "@tracepilot/types";
import {
  Badge,
  formatAiCredits,
  formatDuration,
  formatNumber,
  formatShortDate,
  formatTime,
  SectionPanel,
} from "@tracepilot/ui";
import { usePreferencesStore } from "@/stores/preferences";

const props = defineProps<{
  metrics: ShutdownMetrics;
}>();

const prefs = usePreferencesStore();

function sortedSegmentModels(
  modelMetrics?: Record<string, ModelMetricDetail> | null,
): [string, ModelMetricDetail][] {
  if (!modelMetrics) return [];
  return Object.entries(modelMetrics).sort(([, a], [, b]) => {
    const costDiff = (b.requests?.cost ?? 0) - (a.requests?.cost ?? 0);
    if (costDiff !== 0) return costDiff;
    const tokensA = (a.usage?.inputTokens ?? 0) + (a.usage?.outputTokens ?? 0);
    const tokensB = (b.usage?.inputTokens ?? 0) + (b.usage?.outputTokens ?? 0);
    return tokensB - tokensA;
  });
}

function segmentDurationMs(seg: SessionSegment): number | null {
  if (!seg.startTimestamp || !seg.endTimestamp) return null;
  return new Date(seg.endTimestamp).getTime() - new Date(seg.startTimestamp).getTime();
}

function modelAiCredits(name: string, metric: ModelMetricDetail): AiCreditUsage {
  const usage = metric.usage;
  const hasTokenUsage =
    (usage?.inputTokens ?? 0) +
      (usage?.outputTokens ?? 0) +
      (usage?.cacheReadTokens ?? 0) +
      (usage?.cacheWriteTokens ?? 0) >
    0;
  const usageEstimate = hasTokenUsage
    ? prefs.computeUsageBasedCostBreakdown(
        name,
        usage?.inputTokens ?? 0,
        usage?.cacheReadTokens ?? 0,
        usage?.outputTokens ?? 0,
        usage?.cacheWriteTokens ?? 0,
      )
    : null;
  const directEstimate = hasTokenUsage
    ? prefs.computeWholesaleCostBreakdown(
        name,
        usage?.inputTokens ?? 0,
        usage?.cacheReadTokens ?? 0,
        usage?.outputTokens ?? 0,
        usage?.cacheWriteTokens ?? 0,
      )
    : null;
  return resolveAiCreditUsage(metric.totalNanoAiu, usageEstimate, directEstimate);
}

function segmentAiCredits(segment: SessionSegment): AiCreditUsage {
  const models = Object.entries(segment.modelMetrics ?? {});
  const hasTokenUsage = models.some(
    ([, metric]) =>
      (metric.usage?.inputTokens ?? 0) +
        (metric.usage?.outputTokens ?? 0) +
        (metric.usage?.cacheReadTokens ?? 0) +
        (metric.usage?.cacheWriteTokens ?? 0) >
      0,
  );
  return resolveAiCreditUsage(
    segment.totalNanoAiu,
    hasTokenUsage
      ? sumTokenCosts(
          models.map(([name, metric]) =>
            prefs.computeUsageBasedCostBreakdown(
              name,
              metric.usage?.inputTokens ?? 0,
              metric.usage?.cacheReadTokens ?? 0,
              metric.usage?.outputTokens ?? 0,
              metric.usage?.cacheWriteTokens ?? 0,
            ),
          ),
        )
      : null,
    hasTokenUsage
      ? sumTokenCosts(
          models.map(([name, metric]) =>
            prefs.computeWholesaleCostBreakdown(
              name,
              metric.usage?.inputTokens ?? 0,
              metric.usage?.cacheReadTokens ?? 0,
              metric.usage?.outputTokens ?? 0,
              metric.usage?.cacheWriteTokens ?? 0,
            ),
          ),
        )
      : null,
  );
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
    <div class="activity-horizontal">
      <div
        v-for="(seg, idx) in metrics.sessionSegments"
        :key="idx"
        class="activity-tile"
      >
        <div class="activity-tile-header">
          <div class="flex flex-col">
            <span class="activity-index">Activity #{{ idx + 1 }}</span>
            <span class="activity-date">{{ formatShortDate(seg.startTimestamp) }}</span>
            <span class="activity-timestamp">
              {{ formatTime(seg.startTimestamp) }} → {{ formatTime(seg.endTimestamp) }}
              <span v-if="segmentDurationMs(seg)" class="activity-duration">· {{ formatDuration(segmentDurationMs(seg)) }}</span>
            </span>
          </div>
          <Badge v-if="idx === metrics.sessionSegments.length - 1" variant="success" size="sm">Latest</Badge>
        </div>

        <div class="activity-hero" :class="{ 'activity-hero--empty': seg.tokens === 0 }">
          <div v-if="seg.tokens > 0" class="hero-stats">
            <div class="hero-main">
              <span class="hero-val">{{ formatNumber(seg.tokens) }}</span>
              <span class="hero-unit">tokens</span>
            </div>
          </div>
          <div v-else class="hero-empty">
            <span class="text-[var(--text-tertiary)]">No interaction recorded</span>
          </div>
        </div>

        <div v-if="seg.tokens > 0" class="activity-details">
          <div
            v-for="[name, m] in sortedSegmentModels(seg.modelMetrics)"
            :key="name"
            class="model-row"
          >
            <div class="row-main">
              <span class="model-name">{{ name }}</span>
              <span class="model-tokens">{{ formatNumber((m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0)) }} <small>tokens</small></span>
            </div>
            <div class="row-costs">
              <span
                class="cost-pill blue-text"
                :title="sourceLabel(modelAiCredits(name as string, m).source)"
              >
                {{ formatAiCredits(modelAiCredits(name as string, m).credits) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="seg.tokens > 0" class="activity-tile-costs">
          <span class="cost-pill blue-text" :title="sourceLabel(segmentAiCredits(seg).source)">
            {{ formatAiCredits(segmentAiCredits(seg).credits) }}
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
          <div class="footer-metric">
            <span class="label">AIC</span>
            <span class="val">{{ formatAiCredits(segmentAiCredits(seg).credits).replace(' AIC', '') }}</span>
          </div>
          <div
            v-if="segmentAiCredits(seg).source === 'unavailable' && seg.premiumRequests > 0"
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
.activity-horizontal {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 8px 8px 16px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
  margin: 0 -8px;
  justify-content: center;
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

.hero-empty {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
}

.activity-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-grow: 1;
  margin-bottom: 12px;
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
