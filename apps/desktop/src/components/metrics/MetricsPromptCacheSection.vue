<script setup lang="ts">
/**
 * Prompt-cache section of the Metrics tab: every idle window with its idle
 * time against the cache TTL, the outcome, likely cache-break causes and the
 * usage of the interaction that followed. Older CLI versions do not record
 * cache timing, so their estimate is only shown on request.
 */
import type { CacheConfidence, CacheWindow, PromptCacheTimeline } from "@tracepilot/types";
import { calculateObservedAiCredits, formatNumber, formatTime } from "@tracepilot/types";
import { Badge, DataTable, formatAiCredits, SectionPanel, StatCard, Tooltip } from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed, ref } from "vue";
import {
  CONFIDENCE_EXPLANATIONS,
  CONFIDENCE_LABELS,
  formatApproxTokens,
  formatIdle,
  OUTCOME_LABELS,
} from "@/utils/promptCache";

const props = defineProps<{ timeline: PromptCacheTimeline }>();

const showEstimate = ref(false);
const isTurnGaps = computed(() => props.timeline.source === "turnGaps");
const hasEstimate = computed(() =>
  props.timeline.windows.some((w) => w.confidence === "estimated"),
);
const visibleWindows = computed(() =>
  props.timeline.windows.filter((w) =>
    isTurnGaps.value ? showEstimate.value && w.confidence === "estimated" : true,
  ),
);
const confidence = computed<CacheConfidence>(() => (isTurnGaps.value ? "estimated" : "predicted"));
const summary = computed(() => props.timeline.summary);
const afterExpiry = computed(() => summary.value.expired + summary.value.modelChanged);

const OUTCOME_VARIANTS: Record<CacheWindow["outcome"], "success" | "warning" | "neutral"> = {
  warm: "success",
  expired: "neutral",
  modelChanged: "neutral",
  noCache: "neutral",
  pending: "neutral",
  sessionEnded: "neutral",
  unknown: "neutral",
};

/** Idle time relative to TTL, clamped at 1.5× so the TTL marker stays visible. */
const METER_SPAN = 1.5;
function meterPercent(window: CacheWindow): number | null {
  if (window.idleSeconds == null || !window.ttlSeconds) return null;
  return Math.min(window.idleSeconds / window.ttlSeconds, METER_SPAN) / METER_SPAN;
}
const TTL_MARKER = `${(1 / METER_SPAN) * 100}%`;

const columns = [
  { key: "idleStart", label: "Idle from" },
  { key: "idle", label: "Idle vs TTL" },
  { key: "outcome", label: "Outcome" },
  { key: "prefixTokens", label: "Prefix", align: "right" as const },
  { key: "changes", label: "Likely cache-break causes" },
  { key: "usage", label: "Next interaction", align: "right" as const },
];
const rows = computed(() => visibleWindows.value.map((window) => ({ window })));
const rowWindow = (row: Record<string, unknown>) => row.window as CacheWindow;
</script>

<template>
  <SectionPanel title="Prompt Cache" class="mb-6" data-testid="prompt-cache-section">
    <template #actions>
      <Badge
        v-if="!isTurnGaps || showEstimate"
        :variant="confidence === 'predicted' ? 'success' : 'warning'"
      >
        {{ CONFIDENCE_LABELS[confidence] }}
      </Badge>
      <Tooltip :text="CONFIDENCE_EXPLANATIONS[confidence]">
        <button type="button" aria-label="About prompt-cache timing" class="text-[var(--text-tertiary)]">
          <Info :size="14" />
        </button>
      </Tooltip>
    </template>

    <p v-if="timeline.source === 'none'" class="text-sm text-[var(--text-tertiary)]">
      No idle windows yet. Copilot CLI records cache timing each time the agent goes idle.
    </p>

    <div v-else-if="isTurnGaps" class="prompt-cache__notice">
      <p class="text-sm text-[var(--text-secondary)]">
        Cache timing isn't recorded for this CLI version.
        <template v-if="!hasEstimate">No cache TTL is known for this session's models, so nothing is estimated.</template>
      </p>
      <button
        v-if="hasEstimate"
        type="button"
        class="btn btn-secondary"
        :aria-pressed="showEstimate"
        @click="showEstimate = !showEstimate"
      >
        {{ showEstimate ? 'Hide estimate' : 'Show estimate' }}
      </button>
    </div>

    <template v-if="visibleWindows.length > 0">
      <div class="prompt-cache__stats">
        <StatCard :value="summary.resumedWindows" label="Replies after idle" mini />
        <StatCard :value="summary.warm" label="Warm" color="success" mini />
        <StatCard :value="afterExpiry" label="After expiry" mini />
        <StatCard :value="formatIdle(summary.medianIdleSeconds)" label="Median idle" mini />
      </div>
      <p v-if="summary.resentPrefixTokens > 0" class="text-xs text-[var(--text-tertiary)] mb-3">
        {{ formatApproxTokens(summary.resentPrefixTokens) }} re-sent without cache after expiry
        ({{ CONFIDENCE_LABELS[confidence].toLowerCase() }}).
      </p>

      <div class="prompt-cache__table">
        <DataTable :columns="columns" :rows="rows">
          <template #cell-idleStart="{ row }">
            <span class="tabular">{{ formatTime(rowWindow(row).idleStart) }}</span>
          </template>
          <template #cell-idle="{ row }">
            <div class="prompt-cache__meter-cell">
              <span class="tabular">{{ formatIdle(rowWindow(row).idleSeconds) }}</span>
              <div
                v-if="meterPercent(rowWindow(row)) != null"
                class="prompt-cache__meter"
                :class="{ 'prompt-cache__meter--estimated': rowWindow(row).confidence === 'estimated' }"
                role="img"
                :aria-label="`Idle ${formatIdle(rowWindow(row).idleSeconds)} of a ${formatIdle(rowWindow(row).ttlSeconds)} TTL`"
              >
                <div
                  class="prompt-cache__meter-fill"
                  :class="`prompt-cache__meter-fill--${rowWindow(row).outcome}`"
                  :style="{ width: `${(meterPercent(rowWindow(row)) ?? 0) * 100}%` }"
                />
                <div class="prompt-cache__meter-ttl" :style="{ left: TTL_MARKER }" />
              </div>
            </div>
          </template>
          <template #cell-outcome="{ row }">
            <Badge :variant="OUTCOME_VARIANTS[rowWindow(row).outcome]">
              {{ OUTCOME_LABELS[rowWindow(row).outcome] }}
            </Badge>
          </template>
          <template #cell-prefixTokens="{ row }">
            <span class="tabular">{{ rowWindow(row).prefixTokens == null ? '—' : formatNumber(rowWindow(row).prefixTokens) }}</span>
          </template>
          <template #cell-changes="{ row }">
            <ul v-if="rowWindow(row).prefixChanges.length" class="prompt-cache__changes">
              <li v-for="change in rowWindow(row).prefixChanges" :key="change.kind">
                <Tooltip :text="change.details.join(', ') || change.summary" :disabled="change.details.length === 0">
                  <span>{{ change.summary }}</span>
                </Tooltip>
              </li>
            </ul>
            <span v-else class="text-[var(--text-tertiary)]">—</span>
          </template>
          <template #cell-usage="{ row }">
            <span class="tabular">{{ rowWindow(row).interactionNanoAiu == null ? '—' : formatAiCredits(calculateObservedAiCredits(rowWindow(row).interactionNanoAiu)) }}</span>
          </template>
        </DataTable>
      </div>
      <p class="text-xs text-[var(--text-tertiary)] mt-2">
        The bar marks the cache TTL. A prefix change would likely break the cache even when warm; the session log cannot confirm individual cache hits.
      </p>
    </template>
  </SectionPanel>
</template>

<style scoped>
.prompt-cache__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.prompt-cache__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.prompt-cache__table {
  overflow-x: auto;
}
.prompt-cache__meter-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
}
.prompt-cache__meter-cell > span {
  min-width: 44px;
}
.prompt-cache__meter {
  position: relative;
  flex: 1;
  height: 6px;
  min-width: 80px;
  border-radius: var(--radius-full);
  background: var(--neutral-muted);
}
.prompt-cache__meter--estimated {
  background: transparent;
  outline: 1px dashed var(--border-default);
}
.prompt-cache__meter-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--text-tertiary);
}
.prompt-cache__meter-fill--warm {
  background: var(--success-fg);
}
.prompt-cache__meter-ttl {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: var(--text-secondary);
}
.prompt-cache__changes {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tabular {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .prompt-cache__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
