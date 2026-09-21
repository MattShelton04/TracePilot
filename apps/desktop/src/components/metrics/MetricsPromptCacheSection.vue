<script setup lang="ts">
/**
 * Prompt-cache section of the Metrics tab: every idle window with its idle
 * time against the cache TTL, the outcome and likely cache-break causes.
 * Rows expand to the full details. Older CLI versions do not record cache
 * timing, so their estimate is only shown on request.
 */
import type { CacheWindow, PromptCacheTimeline } from "@tracepilot/types";
import { calculateObservedAiCredits, formatNumber, formatTime } from "@tracepilot/types";
import { Badge, formatAiCredits, SectionPanel, StatCard, Tooltip } from "@tracepilot/ui";
import { ChevronRight, Info } from "lucide-vue-next";
import { computed, ref } from "vue";
import { usePromptCacheCost } from "@/composables/usePromptCacheCost";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { usePreferencesStore } from "@/stores/preferences";
import {
  buildObservationView,
  type ObservationView,
  observationsByWindow,
} from "@/utils/cacheObservations";
import {
  AGENT_RESUME_SOURCE,
  CONFIDENCE_EXPLANATIONS,
  changeKindLabel,
  formatApproxTokens,
  formatIdle,
  idleFractionOfTtl,
  OUTCOME_LABELS,
  windowDetailRows,
} from "@/utils/promptCache";

const props = defineProps<{ timeline: PromptCacheTimeline }>();

const { windowMissCredits, totalMissCredits } = usePromptCacheCost();

// What the resuming requests actually recorded, from the optional session
// store. It sits beside each window's prediction: an observation never
// rewrites an outcome or a confidence, because the two are different claims.
const prefs = usePreferencesStore();
const sessionDetail = useSessionDetailContext();
const observationViews = computed<Map<number, ObservationView>>(() => {
  if (!prefs.isFeatureEnabled("sessionStoreEnrichment")) return new Map();
  const byIndex = observationsByWindow(sessionDetail.promptCacheObservations ?? []);
  const views = new Map<number, ObservationView>();
  for (const window of props.timeline.windows) {
    const observation = byIndex.get(window.index);
    if (observation) views.set(window.index, buildObservationView(window, observation));
  }
  return views;
});

const showEstimate = ref(false);
const expanded = ref(new Set<number>());
const isTurnGaps = computed(() => props.timeline.source === "turnGaps");
const hasEstimate = computed(() =>
  props.timeline.windows.some((w) => w.confidence === "estimated"),
);
const visibleWindows = computed(() =>
  props.timeline.windows.filter((w) =>
    isTurnGaps.value ? showEstimate.value && w.confidence === "estimated" : true,
  ),
);
const summary = computed(() => props.timeline.summary);
const afterExpiry = computed(() => summary.value.expired + summary.value.modelChanged);
const extraCredits = computed(() => totalMissCredits(visibleWindows.value));
const resentTooltip = computed(() => {
  const base = "Replies after the cache expired or on another model.";
  const tokens = summary.value.resentPrefixTokens;
  return tokens > 0 ? `${base} ${formatApproxTokens(tokens)} re-sent.` : base;
});

const OUTCOME_VARIANTS: Record<CacheWindow["outcome"], "success" | "warning" | "neutral"> = {
  warm: "success",
  expired: "neutral",
  modelChanged: "neutral",
  noCache: "neutral",
  pending: "neutral",
  sessionEnded: "neutral",
  unknown: "neutral",
};

/** Idle time relative to the expiry, clamped at 1.5× so the marker stays visible. */
const METER_SPAN = 1.5;
function meterPercent(window: CacheWindow): number | null {
  const fraction = idleFractionOfTtl(window);
  return fraction == null ? null : Math.min(fraction, METER_SPAN) / METER_SPAN;
}
const TTL_MARKER = `${(1 / METER_SPAN) * 100}%`;

function toggle(index: number) {
  const next = new Set(expanded.value);
  if (!next.delete(index)) next.add(index);
  expanded.value = next;
}

function detailRows(window: CacheWindow) {
  const rows = windowDetailRows(window);
  // Misses already list the prefix as "Re-sent".
  if (window.prefixTokens != null && !rows.some((row) => row.label === "Re-sent")) {
    rows.push({ label: "Prefix", value: `${formatNumber(window.prefixTokens)} tokens` });
  }
  if (window.interactionNanoAiu != null) {
    rows.push({
      label: "Next interaction",
      value: formatAiCredits(calculateObservedAiCredits(window.interactionNanoAiu)),
    });
  }
  return rows;
}

function rowCredits(window: CacheWindow) {
  const credits = windowMissCredits(window);
  return credits == null ? "—" : formatAiCredits(credits);
}
</script>

<template>
  <SectionPanel title="Prompt Cache" class="mb-6" data-testid="prompt-cache-section">
    <template #actions>
      <Badge v-if="isTurnGaps && showEstimate" variant="warning">Estimated</Badge>
      <Tooltip :text="CONFIDENCE_EXPLANATIONS[isTurnGaps ? 'estimated' : 'predicted']">
        <button type="button" aria-label="About prompt-cache timing" class="text-[var(--text-tertiary)]">
          <Info :size="14" />
        </button>
      </Tooltip>
    </template>

    <p v-if="timeline.source === 'none'" class="text-sm text-[var(--text-tertiary)]">
      No idle windows yet.
    </p>

    <div v-else-if="isTurnGaps" class="prompt-cache__notice">
      <p class="text-sm text-[var(--text-secondary)]">
        This CLI version doesn't record cache timing.
        <template v-if="!hasEstimate">No cache TTL is known for these models.</template>
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
        <StatCard
          :value="summary.warm"
          label="Warm"
          color="success"
          :tooltip="`Replies sent before the cache expired. Agent wakes aren't counted.`"
          mini
        />
        <StatCard
          :value="afterExpiry"
          label="After expiry"
          :tooltip="resentTooltip"
          mini
        />
        <StatCard
          v-if="summary.agentResumes > 0"
          :value="summary.agentResumes"
          label="Agent wakes"
          tooltip="The agent resumed without a prompt, e.g. when a background task finished."
          mini
        />
        <StatCard
          :value="formatIdle(summary.medianIdleSeconds)"
          label="Median idle"
          tooltip="Median time between going idle and the next reply."
          mini
        />
        <StatCard
          v-if="extraCredits != null"
          :value="formatAiCredits(extraCredits)"
          label="Est. extra cost"
          tooltip="Re-caching the prefix after each miss, from model prices."
          mini
        />
      </div>

      <div class="prompt-cache__table">
        <table class="data-table">
          <thead>
            <tr>
              <th class="prompt-cache__toggle-col"><span class="sr-only">Details</span></th>
              <th>Idle from</th>
              <th>Idle vs TTL</th>
              <th>Outcome</th>
              <th>Likely causes</th>
              <th style="text-align: right" title="Estimated extra cost of re-caching the prefix">Extra cost</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="window in visibleWindows" :key="window.index">
              <tr class="prompt-cache__row" @click="toggle(window.index)">
                <td>
                  <button
                    type="button"
                    class="prompt-cache__toggle"
                    :aria-expanded="expanded.has(window.index)"
                    :aria-label="`Details for idle window from ${formatTime(window.idleStart)}`"
                    @click.stop="toggle(window.index)"
                  >
                    <ChevronRight :size="14" :class="{ 'prompt-cache__chevron--open': expanded.has(window.index) }" />
                  </button>
                </td>
                <td><span class="tabular">{{ formatTime(window.idleStart) }}</span></td>
                <td>
                  <div class="prompt-cache__meter-cell">
                    <span class="tabular">{{ formatIdle(window.idleSeconds) }}</span>
                    <div
                      v-if="meterPercent(window) != null"
                      class="prompt-cache__meter"
                      :class="{ 'prompt-cache__meter--estimated': window.confidence === 'estimated' }"
                      role="img"
                      :aria-label="`Idle ${formatIdle(window.idleSeconds)}; the marker is the cache expiry`"
                    >
                      <div
                        class="prompt-cache__meter-fill"
                        :class="`prompt-cache__meter-fill--${window.outcome}`"
                        :style="{ width: `${(meterPercent(window) ?? 0) * 100}%` }"
                      />
                      <div class="prompt-cache__meter-ttl" :style="{ left: TTL_MARKER }" />
                    </div>
                  </div>
                </td>
                <td>
                  <span class="prompt-cache__outcome">
                    <Badge :variant="OUTCOME_VARIANTS[window.outcome]">
                      {{ OUTCOME_LABELS[window.outcome] }}
                    </Badge>
                    <span v-if="window.resumeSource === AGENT_RESUME_SOURCE" class="prompt-cache__tag">Agent</span>
                    <span v-if="window.confidence === 'estimated' && !isTurnGaps" class="prompt-cache__tag">Estimated</span>
                    <span
                      v-if="observationViews.get(window.index)"
                      class="prompt-cache__tag"
                      :class="{ 'prompt-cache__tag--differs': observationViews.get(window.index)?.tone === 'warning' }"
                      data-testid="prompt-cache-observation-tag"
                    >{{ observationViews.get(window.index)?.comparisonLabel }}</span>
                  </span>
                </td>
                <td>
                  <span v-if="window.prefixChanges.length" class="prompt-cache__chips">
                    <span v-for="change in window.prefixChanges" :key="change.kind" class="prompt-cache__chip">
                      {{ changeKindLabel(change.kind) }}
                    </span>
                  </span>
                  <span v-else class="text-[var(--text-tertiary)]">—</span>
                </td>
                <td style="text-align: right"><span class="tabular">{{ rowCredits(window) }}</span></td>
              </tr>
              <tr v-if="expanded.has(window.index)" class="prompt-cache__detail" data-testid="prompt-cache-detail">
                <td />
                <td colspan="5">
                  <div class="prompt-cache__detail-body">
                    <dl>
                      <template v-for="row in detailRows(window)" :key="row.label">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.value }}</dd>
                      </template>
                    </dl>
                    <ul v-if="window.prefixChanges.length" class="prompt-cache__changes">
                      <li v-for="change in window.prefixChanges" :key="change.kind">
                        <span class="prompt-cache__chip">{{ changeKindLabel(change.kind) }}</span>
                        <span>
                          {{ change.summary }}
                          <span v-if="change.details.length" class="prompt-cache__change-details">
                            {{ change.details.join(', ') }}
                          </span>
                        </span>
                      </li>
                    </ul>
                  </div>
                  <div
                    v-if="observationViews.get(window.index)"
                    class="prompt-cache__observation"
                    :class="{ 'prompt-cache__observation--differs': observationViews.get(window.index)?.tone === 'warning' }"
                    data-testid="prompt-cache-observation"
                  >
                    <p class="prompt-cache__observation-pairing">{{ observationViews.get(window.index)?.pairing }}</p>
                    <dl>
                      <template v-for="row in observationViews.get(window.index)?.rows ?? []" :key="row.label">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.value }}</dd>
                      </template>
                    </dl>
                    <p class="prompt-cache__observation-note">{{ observationViews.get(window.index)?.comparisonNote }}</p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-[var(--text-tertiary)] mt-2">
        The marker is the cache expiry. Causes are likely, not confirmed.
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
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.prompt-cache__table {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.prompt-cache__toggle-col {
  width: 32px;
}
.prompt-cache__row {
  cursor: pointer;
}
.prompt-cache__toggle {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.prompt-cache__toggle:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.prompt-cache__toggle svg {
  transition: transform 0.15s ease;
}
.prompt-cache__chevron--open {
  transform: rotate(90deg);
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
.prompt-cache__outcome,
.prompt-cache__chips {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.prompt-cache__tag {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.prompt-cache__chip {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: var(--radius-full);
  background: var(--warning-subtle);
  color: var(--warning-fg);
  font-size: 0.6875rem;
  font-weight: 600;
  white-space: nowrap;
}
.prompt-cache__detail td {
  background: var(--canvas-subtle);
}
.prompt-cache__detail-body {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 32px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.prompt-cache__detail-body dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}
.prompt-cache__detail-body dt {
  color: var(--text-tertiary);
}
.prompt-cache__detail-body dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.prompt-cache__changes {
  flex: 1;
  min-width: 240px;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prompt-cache__changes li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.prompt-cache__change-details {
  display: block;
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}
.prompt-cache__observation {
  margin-top: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--border-default);
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.prompt-cache__observation--differs {
  border-left-color: var(--attention-fg);
}
.prompt-cache__observation-pairing {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--text-primary);
}
.prompt-cache__observation dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0 0 6px;
}
.prompt-cache__observation dt {
  color: var(--text-tertiary);
}
.prompt-cache__observation dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.prompt-cache__observation-note {
  margin: 0;
  color: var(--text-tertiary);
}
.prompt-cache__tag--differs {
  color: var(--attention-fg);
  font-weight: 600;
}
.tabular {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
