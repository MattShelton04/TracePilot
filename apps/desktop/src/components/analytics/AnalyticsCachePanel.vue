<script setup lang="ts">
/**
 * The prompt cache: how much input it served (read, written or fresh, and per
 * source when several are in range), then how replies after an idle gap
 * fared. Timing comes only from sessions that record it: expiries recorded by
 * Copilot CLI (1.0.75+), or windows timed from model calls (Claude Code), so
 * its denominator is shown.
 */
import type { PromptCacheAnalytics, SessionSource } from "@tracepilot/types";
import { formatNumber, formatPercent, sourceLabel } from "@tracepilot/types";
import { formatAiCredits } from "@tracepilot/ui";
import { Database, Timer } from "lucide-vue-next";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import { usePromptCacheCost } from "@/composables/usePromptCacheCost";
import { SOURCE_COLORS } from "@/utils/analyticsDashboard";
import type { SourceCacheRow, TokenComposition } from "@/utils/analyticsSummary";
import { changeKindLabel, formatIdle } from "@/utils/promptCache";

const props = withDefaults(
  defineProps<{
    composition: TokenComposition;
    bySource: SourceCacheRow[];
    /** Cache timing; absent when the feature is off or the payload predates it. */
    timing?: PromptCacheAnalytics | null;
    /** False when the range includes a source not billed in AI Credits. */
    billedInAic?: boolean;
  }>(),
  { timing: null, billedInAic: true },
);

const { missCredits } = usePromptCacheCost();

const INPUT = [
  { key: "cacheRead", label: "Read", title: "Read from cache", color: "var(--chart-primary)" },
  {
    key: "cacheWrite",
    label: "Written",
    title: "Written to cache",
    color: "var(--chart-secondary)",
  },
  { key: "fresh", label: "Fresh", title: "Fresh input", color: "var(--chart-cyan)" },
] as const;

const input = computed(() => props.composition.input);
const hitRate = computed(() =>
  input.value ? (props.composition.cacheRead / input.value) * 100 : 0,
);
const inputParts = computed(() =>
  INPUT.filter((part) => props.composition[part.key] > 0).map((part) => ({
    ...part,
    value: props.composition[part.key],
    width: (props.composition[part.key] / input.value) * 100,
  })),
);

const resumed = computed(() => props.timing?.resumedWindows ?? 0);
const expiredShare = computed(() =>
  props.timing && resumed.value ? (props.timing.resumesAfterExpiry / resumed.value) * 100 : 0,
);
const causes = computed(() => (props.timing?.topChangeKinds ?? []).slice(0, 4));
const maxCause = computed(() => Math.max(1, ...causes.value.map((c) => c.count)));

/**
 * Sum of priced models only; null when none could be priced. Re-sent tokens
 * are grouped by model, not source, so the AI Credits figure is shown only
 * when every session in range is billed in them.
 */
const extraCredits = computed(() => {
  if (!props.billedInAic || !props.timing) return null;
  let total: number | null = null;
  for (const { model, tokens } of props.timing.resentPrefixTokensByModel ?? []) {
    const credits = missCredits(model, tokens);
    if (credits != null) total = (total ?? 0) + credits;
  }
  return total;
});

const sessionsText = computed(() => {
  const n = props.timing?.sessionsWithPredicted ?? 0;
  return `${n} session${n === 1 ? "" : "s"}`;
});
</script>

<template>
  <OverviewPanel title="Cache" :flush="input > 0" data-testid="analytics-cache">
    <p v-if="!input" class="ad-empty">
      <b>No cache data</b>
      No model input in this range.
    </p>

    <div v-else class="ad-tiles cache__tiles" :class="{ 'cache__tiles--one': timing == null }">
      <div class="ad-tile">
        <div class="ad-tile__label"><Database :size="13" aria-hidden="true" />Input served from cache</div>
        <div
          class="ad-tile__value ad-tile__value--lg"
          :title="`${formatPercent(hitRate)} of input tokens were served from the prompt cache`"
        >
          <span data-count-up>{{ formatPercent(hitRate) }}</span><small>of {{ formatNumber(input) }} input tokens</small>
        </div>
        <div class="ad-meter ad-meter--lg" aria-hidden="true">
          <i
            v-for="part in inputParts"
            :key="part.key"
            :title="`${part.title}: ${formatNumber(part.value)}`"
            :style="{ width: `${part.width}%`, background: part.color }"
            data-reveal="grow-x"
          />
        </div>
        <div class="ad-legend">
          <span v-for="part in inputParts" :key="part.key">
            <i class="ad-sw" :style="{ background: part.color }" />{{ part.label }} <b>{{ formatNumber(part.value) }}</b>
          </span>
        </div>
        <div v-if="bySource.length > 1" class="ad-rows cache__sources">
          <div v-for="row in bySource" :key="row.source" class="ad-row cache__source">
            <span class="ad-row__name">
              <span class="ad-source" :style="{ color: SOURCE_COLORS[row.source as SessionSource] }">
                <SourceLogo :source="row.source" :size="12" />
              </span>
              <span>{{ sourceLabel(row.source) }}</span>
            </span>
            <span class="ad-track"><i :style="{ width: `${row.hitRate}%`, background: 'var(--success-fg)' }" data-reveal="grow-x" /></span>
            <span class="ad-num">{{ formatPercent(row.hitRate) }}</span>
          </div>
        </div>
      </div>

      <div v-if="timing" class="ad-tile" data-testid="analytics-prompt-cache">
        <div class="ad-tile__label">
          <Timer :size="13" aria-hidden="true" />Replies after an idle gap
          <span v-if="resumed" class="ad-tile__aside">{{ sessionsText }}</span>
        </div>
        <template v-if="resumed">
          <div class="ad-tile__value ad-tile__value--lg">
            <span data-count-up>{{ formatPercent(expiredShare) }}</span><small>found the cache expired</small>
          </div>
          <div class="ad-meter ad-meter--lg" aria-hidden="true">
            <i
              :title="`Cache still warm: ${timing.warmResumes}`"
              :style="{ width: `${(timing.warmResumes / resumed) * 100}%`, background: 'var(--success-fg)' }"
              data-reveal="grow-x"
            />
            <i
              :title="`After expiry: ${timing.resumesAfterExpiry}`"
              :style="{ width: `${expiredShare}%`, background: 'var(--warning-fg)' }"
              data-reveal="grow-x"
            />
          </div>
          <div class="ad-legend">
            <span><i class="ad-sw" :style="{ background: 'var(--success-fg)' }" />Warm <b>{{ timing.warmResumes }}</b></span>
            <span><i class="ad-sw" :style="{ background: 'var(--warning-fg)' }" />Expired <b>{{ timing.resumesAfterExpiry }}</b></span>
            <span>Median idle <b>{{ formatIdle(timing.medianIdleSeconds) }}</b></span>
            <span>Re-sent <b>{{ formatNumber(timing.resentPrefixTokens) }}</b></span>
            <span v-if="extraCredits != null">Est. extra cost <b>{{ formatAiCredits(extraCredits) }}</b></span>
          </div>
          <div v-if="causes.length" class="ad-rows cache__causes" role="list" aria-label="Likely cache-break causes">
            <div class="ad-rowh cache__cause">
              <span class="cache__causes-title">Likely cache-break causes</span>
              <span class="ad-num">Windows</span>
            </div>
            <div v-for="cause in causes" :key="cause.kind" class="ad-row cache__cause" role="listitem">
              <span class="ad-row__name"><span>{{ changeKindLabel(cause.kind) }}</span></span>
              <span class="ad-track"><i :style="{ width: `${(cause.count / maxCause) * 100}%`, background: 'var(--warning-fg)' }" data-reveal="grow-x" /></span>
              <span class="ad-num">{{ cause.count }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="ad-tile__value ad-tile__value--muted ad-tile__value--text">No cache timing</div>
          <p class="ad-note">
            No cache timing in this range yet. Copilot CLI sessions need version 1.0.75 or later.
          </p>
        </template>
      </div>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.cache__tiles {
  flex: 1;
}

.cache__tiles--one {
  grid-template-columns: minmax(0, 1fr);
}

.cache__sources,
.cache__causes {
  margin-top: 4px;
}

.cache__source {
  grid-template-columns: minmax(96px, 1fr) minmax(60px, 1.2fr) 44px;
  height: 24px;
  padding: 0;
}

.cache__cause {
  grid-template-columns: minmax(0, 1.3fr) minmax(60px, 1.5fr) 52px;
  height: 24px;
  padding: 0;
}

.cache__causes-title {
  grid-column: span 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@container (max-width: 520px) {
  .cache__tiles {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
