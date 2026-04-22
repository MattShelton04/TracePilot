<script setup lang="ts">
import { EmptyState, ErrorAlert, SectionPanel, useSessionTabLoader } from "@tracepilot/ui";
import { computed } from "vue";
import TokenFlowLegend from "@/components/tokenFlow/TokenFlowLegend.vue";
import TokenFlowSankey from "@/components/tokenFlow/TokenFlowSankey.vue";
import TokenFlowStats from "@/components/tokenFlow/TokenFlowStats.vue";
import { useRenderBudget } from "@/composables/useRenderBudget";
import { SANKEY_COLORS, useSankeyLayout } from "@/composables/useSankeyLayout";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useTokenFlowData } from "@/composables/useTokenFlowData";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const prefs = usePreferencesStore();

useRenderBudget({ key: "render.tokenFlowTabMs", budgetMs: 180, label: "TokenFlowTab" });

useSessionTabLoader(
  () => store.sessionId,
  async () => {
    await Promise.all([store.loadShutdownMetrics(), store.loadTurns()]);
  },
);

function retryLoadTokenFlow() {
  if (store.metricsError) {
    store.loaded.delete("metrics");
    store.loadShutdownMetrics();
  }
  if (store.turnsError) {
    store.loaded.delete("turns");
    store.loadTurns();
  }
}

const tokenFlowError = computed(() => {
  const errors = [store.metricsError, store.turnsError].filter(Boolean);
  return errors.length ? errors.join("; ") : null;
});
const metrics = computed(() => store.shutdownMetrics);
const turns = computed(() => store.turns);

const tokenFlow = useTokenFlowData(metrics, turns, prefs);
const sankeyData = useSankeyLayout(tokenFlow);

const legendItems = computed(() => {
  if (!tokenFlow.hasTurns.value) {
    return [
      { label: "Input Tokens", color: SANKEY_COLORS.emerald },
      { label: "Output Tokens", color: SANKEY_COLORS.indigo },
    ];
  }
  return [
    { label: "User Input", color: SANKEY_COLORS.emerald },
    { label: "Tool Results / Calls", color: SANKEY_COLORS.amber },
    { label: "System / Context", color: SANKEY_COLORS.neutral },
    { label: "Assistant Text / Models", color: SANKEY_COLORS.indigo },
    { label: "Reasoning", color: SANKEY_COLORS.violet },
  ];
});
</script>

<template>
  <div>
    <ErrorAlert
      v-if="tokenFlowError"
      :message="tokenFlowError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadTokenFlow"
    />

    <EmptyState v-if="!metrics && !tokenFlowError" message="No token data available for this session. Token data is only generated after the first session shutdown." />

    <template v-else-if="sankeyData">
      <TokenFlowStats
        :total-tokens="tokenFlow.totalTokens.value"
        :total-input-tokens="tokenFlow.totalInputTokens.value"
        :total-output-tokens="tokenFlow.totalOutputTokens.value"
        :cache-hit-rate="tokenFlow.cacheHitRate.value"
        :models-used="tokenFlow.modelsUsed.value"
        :wholesale-cost="tokenFlow.wholesaleCost.value"
        :copilot-cost="tokenFlow.copilotCost.value"
      />

      <SectionPanel title="Token Flow" class="mb-6">
        <TokenFlowSankey
          :sankey-data="sankeyData"
          :total-tokens="tokenFlow.totalTokens.value"
          :has-turns="tokenFlow.hasTurns.value"
        />
      </SectionPanel>

      <TokenFlowLegend :items="legendItems" />

      <div v-if="tokenFlow.hasTurns.value" class="info-notice">
        ℹ Token attribution is estimated from message content lengths
      </div>
    </template>

    <EmptyState v-else message="No model usage data available for this session." />
  </div>
</template>

<style scoped>
.info-notice {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  padding: 4px 0;
}
</style>
