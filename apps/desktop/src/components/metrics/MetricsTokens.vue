<script setup lang="ts">
/**
 * What the session's tokens were, input and output each on its own scale.
 * Output is usually a few percent of all tokens, so one shared bar would hide
 * it. Both tiles share one shape: a headline, a meter of their kinds, then a
 * note, with the cache hit and the reasoning share under the counts. The context tile
 * shows the window at the last shutdown, which the Context tab charts.
 */
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatNumber, formatNumberFull, formatPercent } from "@tracepilot/types";
import { ArrowRight, Brain, Database, Layers } from "lucide-vue-next";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { COMPOSITION } from "@/utils/analyticsSummary";
import type { MetricsTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import { formatShare } from "@/utils/metricsView";

const props = defineProps<{
  tokens: MetricsTokenBreakdown;
  metrics: ShutdownMetrics;
}>();
defineEmits<{ openContext: [] }>();

const fresh = computed(() => {
  const t = props.tokens;
  return t.uncached ?? (t.notCached != null ? t.notCached - (t.cacheWrite ?? 0) : null);
});
const input = computed(() => {
  const t = props.tokens;
  if (!t.input) return [];
  const values = { cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, fresh: fresh.value };
  return COMPOSITION.filter((part) => part.key !== "output").map((part) => ({
    ...part,
    short: { cacheRead: "Read", cacheWrite: "Written", fresh: "Fresh" }[part.key as "cacheRead"],
    value: values[part.key as keyof typeof values],
    width: ((values[part.key as keyof typeof values] ?? 0) / (t.input as number)) * 100,
  }));
});
const hitRate = computed(() =>
  props.tokens.cacheRatio == null ? null : props.tokens.cacheRatio * 100,
);
const share = (value: number | null) =>
  value != null && props.tokens.total ? formatShare((value / props.tokens.total) * 100) : null;

const output = computed(() => {
  const { output: out, reasoning } = props.tokens;
  if (!out) return [];
  const visible = out - (reasoning ?? 0);
  return [
    { key: "visible", label: "Visible output", value: visible, color: "var(--chart-success)" },
    ...(reasoning
      ? [{ key: "reasoning", label: "Reasoning", value: reasoning, color: "var(--chart-lime)" }]
      : []),
  ].map((part) => ({ ...part, width: (part.value / out) * 100 }));
});

const context = computed(() => {
  const m = props.metrics;
  if (m.currentTokens == null || m.currentTokens <= 0) return null;
  const parts = [
    {
      key: "system",
      label: "System",
      title: "System prompt",
      value: m.systemTokens,
      color: "var(--chart-secondary)",
    },
    {
      key: "tools",
      label: "Tools",
      title: "Tool definitions",
      value: m.toolDefinitionsTokens,
      color: "var(--chart-orange)",
    },
    {
      key: "conversation",
      label: "Conversation",
      title: "Conversation",
      value: m.conversationTokens,
      color: "var(--chart-info)",
    },
  ]
    .filter((part): part is typeof part & { value: number } => part.value != null && part.value > 0)
    .map((part) => ({ ...part, width: (part.value / (m.currentTokens as number)) * 100 }));
  return { total: m.currentTokens, parts };
});
</script>

<template>
  <OverviewPanel title="Tokens" flush data-testid="metrics-tokens">
    <template #aside>
      <span v-if="tokens.total != null"><span class="mono">{{ formatNumberFull(tokens.total) }}</span> tokens</span>
    </template>

    <div class="ad-tiles tokens__tiles" :class="{ 'tokens__tiles--3': context }">
      <div class="ad-tile" data-testid="metrics-tokens-input">
        <div class="ad-tile__label">
          <Database :size="13" aria-hidden="true" />Input
          <span v-if="share(tokens.input)" class="ad-tile__aside">{{ share(tokens.input) }} of all tokens</span>
        </div>
        <div class="tokens__hero">
          <div class="tokens__hero-text">
            <span class="tokens__big"><span class="kpi__value-num">{{ tokens.input == null ? "—" : formatNumber(tokens.input) }}</span><small>input tokens</small></span>
            <span class="tokens__hero-note">
              <template v-if="hitRate == null">Cache reads not recorded</template>
              <template v-else><b class="tokens__hit">{{ formatPercent(hitRate) }}</b> read from the prompt cache</template>
            </span>
          </div>
        </div>
        <template v-if="input.length">
          <div class="ad-meter ad-meter--lg" aria-hidden="true">
            <i v-for="part in input" :key="part.key" :title="`${part.label}: ${formatNumberFull(part.value ?? 0)}`" :style="{ width: `${part.width}%`, background: part.color }" data-reveal="grow-x" />
          </div>
          <div class="ad-legend">
            <span v-for="part in input" :key="part.key">
              <i class="ad-sw" :style="{ background: part.color }" />{{ part.short }} <b>{{ part.value == null ? "—" : formatNumber(part.value) }}</b>
            </span>
          </div>
        </template>
        <p class="ad-note tokens__note">{{ tokens.cacheWrite ? "Cache writes are billed above fresh input, cache reads well below it." : "Cache reads are billed well below fresh input." }}</p>
        <p v-if="tokens.inconsistent" class="ad-note warn">Recorded categories do not reconcile.</p>
      </div>

      <div class="ad-tile" data-testid="metrics-tokens-output">
        <div class="ad-tile__label">
          <Brain :size="13" aria-hidden="true" />Output
          <span v-if="share(tokens.output)" class="ad-tile__aside">{{ share(tokens.output) }} of all tokens</span>
        </div>
        <div class="tokens__hero">
          <div class="tokens__hero-text">
            <span class="tokens__big"><span class="kpi__value-num">{{ tokens.output == null ? "—" : formatNumber(tokens.output) }}</span><small>output tokens</small></span>
            <span class="tokens__hero-note">
              <template v-if="tokens.reasoning == null">Reasoning not recorded</template>
              <template v-else-if="tokens.output"><b>{{ formatShare((tokens.reasoning / tokens.output) * 100) }}</b> of them reasoning</template>
            </span>
          </div>
        </div>
        <template v-if="output.length">
          <div class="ad-meter ad-meter--lg" aria-hidden="true">
            <i v-for="part in output" :key="part.key" :title="`${part.label}: ${formatNumberFull(part.value)}`" :style="{ width: `${part.width}%`, background: part.color }" data-reveal="grow-x" />
          </div>
          <div class="ad-legend">
            <span v-for="part in output" :key="part.key"><i class="ad-sw" :style="{ background: part.color }" />{{ part.label }} <b>{{ formatNumber(part.value) }}</b></span>
          </div>
        </template>
        <p class="ad-note tokens__note">Reasoning is counted within output and billed as output.</p>
      </div>

      <div v-if="context" class="ad-tile" data-testid="metrics-tokens-context">
        <div class="ad-tile__label">
          <Layers :size="13" aria-hidden="true" />Context
          <button type="button" class="ad-link tokens__link" @click="$emit('openContext')">Context tab <ArrowRight :size="12" aria-hidden="true" /></button>
        </div>
        <div class="tokens__hero">
          <div class="tokens__hero-text">
            <span class="tokens__big"><span class="kpi__value-num">{{ formatNumber(context.total) }}</span><small>tokens in the window</small></span>
            <span class="tokens__hero-note">At the last shutdown</span>
          </div>
        </div>
        <div class="ad-meter ad-meter--lg" aria-hidden="true">
          <i v-for="part in context.parts" :key="part.key" :title="`${part.title}: ${formatNumberFull(part.value)}`" :style="{ width: `${part.width}%`, background: part.color }" data-reveal="grow-x" />
        </div>
        <div class="ad-legend">
          <span v-for="part in context.parts" :key="part.key"><i class="ad-sw" :style="{ background: part.color }" />{{ part.label }} <b>{{ formatNumber(part.value) }}</b></span>
        </div>
      </div>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.tokens__tiles {
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.tokens__tiles--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.tokens__hero {
  display: flex;
  align-items: center;
  min-width: 0;
}

.tokens__hero-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tokens__big {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font: 600 22px / 28px var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  white-space: nowrap;
}

.tokens__big small {
  font: 400 12px / 16px var(--font-family);
  color: var(--text-tertiary);
}

.tokens__hero-note b.tokens__hit {
  color: var(--success-fg);
}

.tokens__hero-note {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.tokens__note {
  margin-top: auto;
}

.tokens__hero-note b {
  font: 500 12px / 16px var(--font-mono);
  color: var(--text-secondary);
}

.tokens__link {
  margin-left: auto;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.warn {
  color: var(--warning-fg);
}

@container (max-width: 900px) {
  .tokens__tiles--3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tokens__tiles--3 > :last-child {
    grid-column: 1 / -1;
  }
}

@container (max-width: 560px) {
  .tokens__tiles,
  .tokens__tiles--3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
