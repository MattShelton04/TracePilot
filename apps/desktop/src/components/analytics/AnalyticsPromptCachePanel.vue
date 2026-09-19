<script setup lang="ts">
/**
 * Cross-session prompt-cache timing. Only sessions whose expiries were
 * predicted by Copilot CLI (1.0.75+) contribute, and the denominator is shown.
 */
import type { PrefixChangeKind, PromptCacheAnalytics } from "@tracepilot/types";
import { formatPercent } from "@tracepilot/types";
import { SectionPanel, Tooltip } from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed } from "vue";
import {
  CHANGE_KIND_LABELS,
  CONFIDENCE_EXPLANATIONS,
  formatApproxTokens,
  formatIdle,
} from "@/utils/promptCache";

const props = defineProps<{ data: PromptCacheAnalytics }>();

const afterExpiryPercent = computed(() =>
  props.data.resumedWindows > 0
    ? (props.data.resumesAfterExpiry / props.data.resumedWindows) * 100
    : null,
);
const causes = computed(() => props.data.topChangeKinds.slice(0, 4));
const sessionsLabel = computed(() =>
  props.data.sessionsWithPredicted === 1
    ? "from 1 session"
    : `from ${props.data.sessionsWithPredicted} sessions`,
);
const causeLabel = (kind: string) => CHANGE_KIND_LABELS[kind as PrefixChangeKind] ?? kind;
</script>

<template>
  <SectionPanel title="Prompt Cache Timing" data-testid="analytics-prompt-cache">
    <template #actions>
      <span v-if="data.resumedWindows > 0" class="text-xs text-[var(--text-tertiary)]">{{ sessionsLabel }}</span>
      <Tooltip :text="`Only replies whose cache expiry was predicted by Copilot CLI are counted. ${CONFIDENCE_EXPLANATIONS.predicted}`">
        <button type="button" aria-label="About prompt cache timing" class="text-[var(--text-tertiary)]">
          <Info :size="14" />
        </button>
      </Tooltip>
    </template>

    <p v-if="data.resumedWindows === 0" class="prompt-timing__empty">
      No replies with predicted cache timing in this range yet. Copilot CLI 1.0.75 and later record it.
    </p>
    <template v-else>
      <div class="prompt-timing__grid">
        <div class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ formatPercent(afterExpiryPercent) }}</span>
          <span class="prompt-timing__label">Replies after predicted expiry</span>
        </div>
        <div class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ formatIdle(data.medianIdleSeconds) }}</span>
          <span class="prompt-timing__label">Median idle before reply</span>
        </div>
        <div class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ data.resumedWindows }}</span>
          <span class="prompt-timing__label">Replies after idle</span>
        </div>
      </div>
      <p v-if="data.resentPrefixTokens > 0" class="prompt-timing__note">
        {{ formatApproxTokens(data.resentPrefixTokens) }} re-sent without cache after expiry (predicted).
      </p>
      <div v-if="causes.length" class="prompt-timing__causes">
        <div class="prompt-timing__causes-title">Top likely cache-break causes</div>
        <ul>
          <li v-for="cause in causes" :key="cause.kind">
            <span>{{ causeLabel(cause.kind) }}</span>
            <span class="prompt-timing__count">{{ cause.count }}</span>
          </li>
        </ul>
      </div>
    </template>
  </SectionPanel>
</template>

<style scoped>
.prompt-timing__empty {
  padding: 18px;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}
.prompt-timing__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 18px 18px 8px;
}
.prompt-timing__metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.prompt-timing__value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.prompt-timing__label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.prompt-timing__note {
  margin: 0;
  padding: 0 18px 8px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
}
.prompt-timing__causes {
  padding: 8px 18px 18px;
  border-top: 1px solid var(--border-subtle);
}
.prompt-timing__causes-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.prompt-timing__causes ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
.prompt-timing__causes li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.prompt-timing__count {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
