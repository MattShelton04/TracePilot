<script setup lang="ts">
/**
 * Prompt-cache section of the Metrics tab: the estimated extra cost of
 * cache misses and how replies after an idle gap fared, then every idle
 * window as a dot on a log scale of idle time against the cache TTL, the
 * likely cache-break causes, and the windows as a table. Long sessions have many windows, so the table is a
 * paged disclosure (open by default when short) that can be narrowed to
 * misses and prefix changes. Rows expand to the full details. Older CLI
 * versions do not record cache timing, so their estimate is only shown on
 * request.
 */
import type { CacheWindow, PromptCacheTimeline, SessionSource } from "@tracepilot/types";
import { calculateObservedAiCredits, formatNumber, formatTime } from "@tracepilot/types";
import { Badge, ExpandChevron, formatAiCreditsUsd, formatShortDate, Tooltip } from "@tracepilot/ui";
import { ChevronRight, Coins, Hourglass, Info, RotateCcw, Unplug } from "lucide-vue-next";
import { computed, ref, useId } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useClientPager } from "@/composables/useClientPager";
import { useElementWidth } from "@/composables/useElementWidth";
import { usePromptCacheCost } from "@/composables/usePromptCacheCost";
import { idlePercent, idleScale, idleTicks, stackDots } from "@/utils/metricsView";
import {
  AGENT_RESUME_SOURCE,
  CONFIDENCE_EXPLANATIONS,
  changeKindLabel,
  formatApproxTokens,
  formatIdle,
  idleFractionOfTtl,
  isNotableWindow,
  OUTCOME_LABELS,
  resumeChipLabel,
  windowDetailRows,
} from "@/utils/promptCache";

const props = defineProps<{ timeline: PromptCacheTimeline; source?: SessionSource }>();

const { windowMissCost, totalMissCost, formatMissCost } = usePromptCacheCost(() => props.source);

const showEstimate = ref(false);
const expanded = ref(new Set<number>());
const isTurnGaps = computed(() => props.timeline.source === "turnGaps");
const timingExplanation = computed(
  () =>
    CONFIDENCE_EXPLANATIONS[
      props.timeline.source === "modelCalls"
        ? "observed"
        : isTurnGaps.value
          ? "estimated"
          : "predicted"
    ],
);
const hasEstimate = computed(() =>
  props.timeline.windows.some((w) => w.confidence === "estimated"),
);
const visibleWindows = computed(() =>
  isTurnGaps.value
    ? showEstimate.value
      ? props.timeline.windows.filter((w) => w.confidence === "estimated")
      : []
    : props.timeline.windows,
);
/** Short tables start open; the user's choice wins once made. */
const OPEN_BY_DEFAULT_MAX = 10;
const PAGE_SIZE = 20;
const tableChoice = ref<boolean | null>(null);
const tableId = useId();
const tableOpen = computed(
  () => tableChoice.value ?? visibleWindows.value.length <= OPEN_BY_DEFAULT_MAX,
);
const onlyNotable = ref(false);
const notableCount = computed(() => visibleWindows.value.filter(isNotableWindow).length);
// The filter only helps when it would hide something and leave something.
const canFilter = computed(
  () => notableCount.value > 0 && notableCount.value < visibleWindows.value.length,
);
const tableWindows = computed(() =>
  onlyNotable.value && canFilter.value
    ? visibleWindows.value.filter(isNotableWindow)
    : visibleWindows.value,
);
const { page, pageCount, pageRows } = useClientPager(tableWindows, PAGE_SIZE, [onlyNotable]);
const windowCountLabel = computed(() => {
  const count = visibleWindows.value.length;
  return `${count} idle window${count === 1 ? "" : "s"}`;
});

const summary = computed(() => props.timeline.summary);
const afterExpiry = computed(() => summary.value.expired + summary.value.modelChanged);
const extraCost = computed(() => totalMissCost(visibleWindows.value));
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

/** A warm prediction with a likely or recorded break reads as a break. */
function outcomeBadge(window: CacheWindow) {
  if (window.outcome === "warm" && window.prefixChanges.length > 0) {
    return { label: resumeChipLabel(window), variant: "warning" as const };
  }
  return { label: OUTCOME_LABELS[window.outcome], variant: OUTCOME_VARIANTS[window.outcome] };
}

const replies = computed(() => summary.value.warm + afterExpiry.value);
const expiredShare = computed(() =>
  replies.value ? (afterExpiry.value / replies.value) * 100 : 0,
);
const pending = computed(() => props.timeline.windows.find((w) => w.outcome === "pending") ?? null);
const resentLabel = computed(() =>
  formatApproxTokens(summary.value.resentPrefixTokens).replace(/^about | tokens$/g, ""),
);
// Nothing missed costs nothing; a dash means the misses couldn't be priced.
const extraCostLabel = computed(() => {
  if (extraCost.value != null) return formatMissCost(extraCost.value);
  return afterExpiry.value ? "—" : formatMissCost(0);
});

// Idle time vs TTL: one dot per window on a log scale of idle time.
const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 800);
const DOT = 9;
const MAX_ROWS = 10;
const plotted = computed(() =>
  visibleWindows.value.filter((w) => w.idleSeconds != null && w.idleSeconds > 0),
);
const ttls = computed(() =>
  [
    ...new Set(
      plotted.value.map((w) => w.ttlSeconds).filter((t): t is number => t != null && t > 0),
    ),
  ].sort((a, b) => a - b),
);
const scale = computed(() =>
  idleScale([...plotted.value.map((w) => w.idleSeconds as number), ...ttls.value]),
);
const plotWidth = computed(() => Math.max(200, width.value));
const dots = computed(() => {
  const pcts = plotted.value.map((w) => idlePercent(w.idleSeconds as number, scale.value));
  const rows = stackDots(pcts, plotWidth.value, DOT);
  return plotted.value.map((w, i) => ({
    window: w,
    pct: pcts[i],
    row: Math.min(rows[i], MAX_ROWS - 1),
  }));
});
const plotHeight = computed(
  () => 20 + Math.min(MAX_ROWS, Math.max(1, ...dots.value.map((d) => d.row + 1))) * DOT,
);
const ticks = computed(() => idleTicks(scale.value, plotWidth.value));
const hovered = ref<CacheWindow | null>(null);

function dotTone(window: CacheWindow): "warm" | "break" | "miss" | "other" {
  if (window.outcome === "warm") return window.prefixChanges.length ? "break" : "warm";
  if (window.outcome === "expired" || window.outcome === "modelChanged") return "miss";
  return "other";
}
function dotLabel(window: CacheWindow): string {
  const cost = windowMissCost(window);
  return [
    `Idle ${formatIdle(window.idleSeconds)}`,
    outcomeBadge(window).label,
    window.resumeSource === AGENT_RESUME_SOURCE ? "agent woke itself" : null,
    `${formatShortDate(window.idleStart)} ${formatTime(window.idleStart)}`,
    cost != null ? `extra cost ${formatMissCost(cost)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
/** Opens the table at a window's row, expanded. */
function reveal(window: CacheWindow) {
  tableChoice.value = true;
  onlyNotable.value = false;
  const index = tableWindows.value.indexOf(window);
  if (index >= 0) page.value = Math.floor(index / PAGE_SIZE);
  const next = new Set(expanded.value);
  next.add(window.index);
  expanded.value = next;
}
const causes = computed(() => {
  const counts = new Map<string, number>();
  for (const window of visibleWindows.value) {
    for (const change of window.prefixChanges) {
      counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
});
const maxCause = computed(() => Math.max(1, ...causes.value.map((c) => c.count)));

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
      value: formatAiCreditsUsd(calculateObservedAiCredits(window.interactionNanoAiu)),
    });
  }
  return rows;
}

function rowCost(window: CacheWindow) {
  const cost = windowMissCost(window);
  return cost == null ? "—" : formatMissCost(cost);
}
</script>

<template>
  <OverviewPanel title="Prompt cache" data-testid="prompt-cache-section">
    <template #aside>
      <span v-if="timeline.source === 'modelCalls'">Timed from model calls</span>
      <span v-else-if="timeline.source === 'checkpoints'">Expiry recorded by Copilot CLI</span>
      <Badge v-if="isTurnGaps && showEstimate" variant="warning">Estimated</Badge>
      <Tooltip :text="timingExplanation">
        <button type="button" aria-label="About prompt-cache timing" class="text-[var(--text-tertiary)]">
          <Info :size="14" />
        </button>
      </Tooltip>
    </template>

    <div ref="root" class="prompt-cache">
    <p v-if="timeline.source === 'none'" class="ad-empty">
      <b>No idle windows yet.</b>
      The session hasn't sat idle long enough for its prompt cache to matter.
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
      <div class="ad-tiles prompt-cache__tiles">
        <div class="ad-tile" data-testid="prompt-cache-extra-cost">
          <div class="ad-tile__label"><Coins :size="13" aria-hidden="true" />Est. extra cost</div>
          <div class="ad-tile__value ad-tile__value--lg" :class="{ 'prompt-cache__cost-value': extraCost }">
            <span class="kpi__value-num">{{ extraCostLabel }}</span>
          </div>
          <div class="ad-tile__detail" title="Re-caching the prefix after each miss, from model prices.">
            <template v-if="!afterExpiry">No replies after the cache expired</template>
            <template v-else-if="extraCost == null">No prices for these models</template>
            <template v-else-if="summary.resentPrefixTokens"><b>{{ resentLabel }}</b> tokens re-cached after misses</template>
            <template v-else>Re-caching the prefix after misses</template>
          </div>
        </div>
        <div class="ad-tile" data-testid="prompt-cache-replies">
          <div class="ad-tile__label">
            <RotateCcw :size="13" aria-hidden="true" />Replies after idle
            <span v-if="summary.agentResumes" class="ad-tile__aside" title="The agent resumed without a prompt, e.g. when a background task finished.">+{{ summary.agentResumes }} agent wake{{ summary.agentResumes === 1 ? "" : "s" }}</span>
          </div>
          <div class="ad-tile__value ad-tile__value--lg">
            <span class="kpi__value-num">{{ replies }}</span>
            <small>
              <span class="prompt-cache__warm" title="Replies sent before the cache expired. Agent wakes aren't counted.">{{ summary.warm }} warm</span>
              ·
              <span class="prompt-cache__miss" :title="resentTooltip">{{ afterExpiry }} after expiry</span>
            </small>
          </div>
          <div v-if="replies" class="ad-meter" aria-hidden="true">
            <i v-if="summary.warm" :style="{ width: `${100 - expiredShare}%`, background: 'var(--success-fg)' }" data-reveal="grow-x" />
            <i v-if="afterExpiry" :style="{ width: `${expiredShare}%`, background: 'var(--warning-fg)' }" data-reveal="grow-x" />
          </div>
          <div v-else class="ad-tile__detail">No replies after an idle gap yet</div>
        </div>
        <div class="ad-tile" data-testid="prompt-cache-breaks">
          <div class="ad-tile__label"><Unplug :size="13" aria-hidden="true" />Likely cache breaks</div>
          <div class="ad-tile__value ad-tile__value--lg" :class="{ 'prompt-cache__break-value': summary.likelyBreaks }">
            <span class="kpi__value-num">{{ summary.likelyBreaks }}</span>
          </div>
          <div class="ad-tile__detail" title="The prompt prefix changed before a reply, so it likely missed the cache even while warm.">
            <template v-if="causes.length">Mostly <b>{{ changeKindLabel(causes[0].kind).toLocaleLowerCase() }}</b> changes</template>
            <template v-else>No prefix changes found</template>
            <template v-if="summary.modelChanged"> · {{ summary.modelChanged }} on another model</template>
          </div>
        </div>
        <div class="ad-tile" data-testid="prompt-cache-idle">
          <div class="ad-tile__label"><Hourglass :size="13" aria-hidden="true" />Median idle</div>
          <div class="ad-tile__value ad-tile__value--lg"><span>{{ formatIdle(summary.medianIdleSeconds) }}</span></div>
          <div class="ad-tile__detail">
            <template v-if="pending"><span class="prompt-cache__live">Live</span> idle now<template v-if="pending.expiresAt"> · expires {{ formatTime(pending.expiresAt) }}</template></template>
            <template v-else-if="ttls.length">Cache TTL {{ ttls.map((t) => formatIdle(t)).join(" / ") }}</template>
            <template v-else>Between going idle and the next reply</template>
          </div>
        </div>
      </div>

      <div v-if="dots.length" class="prompt-cache__plot-wrap">
        <div class="prompt-cache__plot" :style="{ height: `${plotHeight}px` }" role="group" :aria-label="`${dots.length} idle windows by idle time; the dashed lines are the cache TTL`">
          <span v-for="ttl in ttls" :key="ttl" class="prompt-cache__ttl" :class="{ 'prompt-cache__ttl--end': idlePercent(ttl, scale) > 75 }" :style="{ left: `${idlePercent(ttl, scale)}%` }"><em>TTL {{ formatIdle(ttl) }}</em></span>
          <button
            v-for="dot in dots"
            :key="dot.window.index"
            type="button"
            class="prompt-cache__dot"
            :class="[`prompt-cache__dot--${dotTone(dot.window)}`, { 'prompt-cache__dot--agent': dot.window.resumeSource === AGENT_RESUME_SOURCE }]"
            :style="{ left: `${dot.pct}%`, bottom: `${4 + dot.row * DOT}px` }"
            :aria-label="dotLabel(dot.window)"
            data-reveal="pop"
            @mouseenter="hovered = dot.window"
            @focus="hovered = dot.window"
            @mouseleave="hovered = null"
            @blur="hovered = null"
            @click="reveal(dot.window)"
          />
        </div>
        <div class="prompt-cache__axis" aria-hidden="true">
          <span v-for="tick in ticks" :key="tick.label" :class="{ 'prompt-cache__tick--start': tick.pct < 2, 'prompt-cache__tick--end': tick.pct > 98 }" :style="{ left: `${tick.pct}%` }">{{ tick.label }}</span>
        </div>
        <div class="prompt-cache__readout" aria-live="polite">
          <span v-if="hovered">{{ dotLabel(hovered) }}</span>
          <div v-else class="ad-legend">
            <span><i class="ad-sw prompt-cache__dot--warm" />Warm</span>
            <span><i class="ad-sw prompt-cache__dot--miss" />After expiry</span>
            <span v-if="dots.some((d) => dotTone(d.window) === 'break')"><i class="ad-sw prompt-cache__dot--break" />Likely cache break</span>
            <span v-if="dots.some((d) => d.window.resumeSource === AGENT_RESUME_SOURCE)"><i class="ad-sw prompt-cache__sw-agent" />Agent woke itself</span>
            <span>Select a dot to open its window</span>
          </div>
        </div>
      </div>

      <div v-if="causes.length" class="ad-rows prompt-cache__causes" role="list" aria-label="Likely cache-break causes">
        <div class="ad-rowh prompt-cache__cause"><span>Likely cache-break causes</span><span /><span class="ad-num">Windows</span></div>
        <div v-for="cause in causes" :key="cause.kind" class="ad-row prompt-cache__cause" role="listitem">
          <span class="ad-row__name"><span>{{ changeKindLabel(cause.kind) }}</span></span>
          <span class="ad-track"><i :style="{ width: `${(cause.count / maxCause) * 100}%`, background: 'var(--warning-fg)' }" data-reveal="grow-x" /></span>
          <span class="ad-num">{{ cause.count }}</span>
        </div>
      </div>

      <div class="prompt-cache__table-bar">
        <button
          type="button"
          class="prompt-cache__disclosure"
          :aria-expanded="tableOpen"
          :aria-controls="tableId"
          data-testid="prompt-cache-disclosure"
          @click="tableChoice = !tableOpen"
        >
          <ExpandChevron :expanded="tableOpen" />
          {{ tableOpen ? "Hide" : "Show" }} {{ windowCountLabel }}
        </button>
        <label v-if="tableOpen && canFilter" class="prompt-cache__filter">
          <input v-model="onlyNotable" type="checkbox" data-testid="prompt-cache-notable-filter" />
          Only misses &amp; prefix changes ({{ notableCount }})
        </label>
      </div>

      <div v-if="tableOpen" :id="tableId" class="prompt-cache__table">
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
            <template v-for="window in pageRows" :key="window.index">
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
                        data-reveal="grow-x"
                        :class="`prompt-cache__meter-fill--${window.outcome}`"
                        :style="{ width: `${(meterPercent(window) ?? 0) * 100}%` }"
                      />
                      <div class="prompt-cache__meter-ttl" :style="{ left: TTL_MARKER }" />
                    </div>
                  </div>
                </td>
                <td>
                  <span class="prompt-cache__outcome">
                    <Badge :variant="outcomeBadge(window).variant">
                      {{ outcomeBadge(window).label }}
                    </Badge>
                    <span v-if="window.resumeSource === AGENT_RESUME_SOURCE" class="prompt-cache__tag">Agent</span>
                    <span v-if="window.confidence === 'estimated' && !isTurnGaps" class="prompt-cache__tag">Estimated</span>
                    <span v-else-if="window.confidence === 'observed'" class="prompt-cache__tag">Estimated expiry</span>
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
                <td style="text-align: right"><span class="tabular">{{ rowCost(window) }}</span></td>
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
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div v-if="tableOpen && pageCount > 1" class="flex items-center gap-4 mt-2 text-xs">
        <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous</button>
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">Next</button>
      </div>
      <p v-if="tableOpen" class="text-xs text-[var(--text-tertiary)] mt-2">
        The marker is the cache expiry. Causes are likely, not confirmed.
      </p>
    </template>
    </div>
  </OverviewPanel>
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
.prompt-cache {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.prompt-cache__tiles {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0 -16px;
  border-block: 1px solid var(--border-muted);
}
.prompt-cache__tiles:first-child {
  margin-top: -14px;
  border-top: 0;
}
.prompt-cache__cost-value {
  color: var(--warning-fg);
}
.prompt-cache__warm {
  color: var(--success-fg);
}
.prompt-cache__miss {
  color: var(--warning-fg);
}
.prompt-cache__sep {
  color: var(--text-tertiary);
}
.prompt-cache__live {
  margin-right: 4px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--success-muted);
  color: var(--success-fg);
  font-size: 11px;
  font-weight: 600;
}
.prompt-cache__plot-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prompt-cache__plot {
  position: relative;
  border-bottom: 1px solid var(--border-default);
}
.prompt-cache__ttl {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--text-secondary);
  pointer-events: none;
}
.prompt-cache__ttl em {
  position: absolute;
  top: -2px;
  left: 6px;
  font: normal 11px / 14px var(--font-family);
  color: var(--text-secondary);
  white-space: nowrap;
}
.prompt-cache__dot {
  position: absolute;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}
.prompt-cache__dot:hover,
.prompt-cache__dot:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 1px;
}
.prompt-cache__dot--warm {
  background: var(--success-fg);
}
.prompt-cache__dot--miss {
  background: var(--warning-fg);
}
.prompt-cache__dot--break {
  background: var(--attention-fg);
}
.prompt-cache__dot--other {
  background: var(--text-tertiary);
}
.prompt-cache__dot--agent {
  box-shadow:
    0 0 0 1.5px var(--canvas-subtle),
    0 0 0 2.5px var(--text-tertiary);
}
.prompt-cache__sw-agent {
  background: transparent;
  border: 1.5px solid var(--text-tertiary);
  border-radius: 50%;
}
.prompt-cache__axis {
  position: relative;
  height: 16px;
  font: 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
}
.prompt-cache__axis span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.prompt-cache__axis .prompt-cache__tick--start {
  transform: none;
}
.prompt-cache__axis .prompt-cache__tick--end {
  transform: translateX(-100%);
}
.prompt-cache__ttl--end em {
  left: auto;
  right: 6px;
}
.prompt-cache__break-value {
  color: var(--attention-fg);
}
.prompt-cache__readout {
  min-height: 16px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
}
.prompt-cache__causes .ad-row,
.prompt-cache__causes .ad-rowh {
  height: 24px;
}
.prompt-cache__cause {
  grid-template-columns: minmax(0, 1.3fr) minmax(60px, 1.5fr) 60px;
}
@container (max-width: 900px) {
  .prompt-cache__tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.prompt-cache__table-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 8px;
}
.prompt-cache__disclosure {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.prompt-cache__disclosure:hover {
  color: var(--text-primary);
}
.prompt-cache__disclosure:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.prompt-cache__filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
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
.tabular {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
