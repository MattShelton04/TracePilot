<script setup lang="ts">
/**
 * Cross-session prompt-cache timing. Only sessions whose expiries were
 * recorded by Copilot CLI (1.0.75+) contribute, and the denominator is shown.
 */
import type { PromptCacheAnalytics } from "@tracepilot/types";
import { formatPercent } from "@tracepilot/types";
import { formatAiCredits, SectionPanel, Tooltip } from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed } from "vue";
import { usePromptCacheCost } from "@/composables/usePromptCacheCost";
import { changeKindLabel, formatIdle } from "@/utils/promptCache";

const props = defineProps<{ data: PromptCacheAnalytics }>();

const { missCredits } = usePromptCacheCost();

const afterExpiryPercent = computed(() =>
  props.data.resumedWindows > 0
    ? (props.data.resumesAfterExpiry / props.data.resumedWindows) * 100
    : null,
);
const causes = computed(() => props.data.topChangeKinds.slice(0, 4));
const maxCauseCount = computed(() => Math.max(1, ...causes.value.map((c) => c.count)));
const sessionsLabel = computed(() =>
  props.data.sessionsWithPredicted === 1
    ? "from 1 session"
    : `from ${props.data.sessionsWithPredicted} sessions`,
);
/** Sum of priced models only; null when none could be priced. */
const extraCredits = computed(() => {
  let total: number | null = null;
  for (const { model, tokens } of props.data.resentPrefixTokensByModel ?? []) {
    const credits = missCredits(model, tokens);
    if (credits != null) total = (total ?? 0) + credits;
  }
  return total;
});
</script>

<template>
  <SectionPanel title="Prompt Cache Timing" data-testid="analytics-prompt-cache">
    <template #actions>
      <span v-if="data.resumedWindows > 0" class="text-xs text-[var(--text-tertiary)]">{{ sessionsLabel }}</span>
      <Tooltip text="Replies after idle, from sessions where Copilot CLI recorded the cache expiry. Agent wakes are excluded.">
        <button type="button" aria-label="About prompt cache timing" class="text-[var(--text-tertiary)]">
          <Info :size="14" />
        </button>
      </Tooltip>
    </template>

    <p v-if="data.resumedWindows === 0" class="prompt-timing__empty">
      No cache timing in this range yet. Needs Copilot CLI 1.0.75 or later.
    </p>
    <template v-else>
      <div class="prompt-timing__grid">
        <div class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ formatPercent(afterExpiryPercent) }}</span>
          <span class="prompt-timing__label">Replies after expiry</span>
        </div>
        <div class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ formatIdle(data.medianIdleSeconds) }}</span>
          <span class="prompt-timing__label">Median idle</span>
        </div>
        <div class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ data.resumedWindows }}</span>
          <span class="prompt-timing__label">Replies after idle</span>
        </div>
        <div v-if="extraCredits != null" class="prompt-timing__metric">
          <span class="prompt-timing__value">{{ formatAiCredits(extraCredits) }}</span>
          <span class="prompt-timing__label">Est. extra cost</span>
        </div>
      </div>
      <section v-if="causes.length" class="prompt-timing__causes" aria-labelledby="prompt-timing-causes">
        <header class="prompt-timing__causes-header">
          <h4 id="prompt-timing-causes">Likely cache-break causes</h4>
          <span>Windows</span>
        </header>
        <ul>
          <li v-for="cause in causes" :key="cause.kind" class="prompt-timing__cause">
            <span class="prompt-timing__cause-label">{{ changeKindLabel(cause.kind) }}</span>
            <span class="prompt-timing__bar" aria-hidden="true">
              <span class="prompt-timing__bar-fill" :style="{ width: `${(cause.count / maxCauseCount) * 100}%` }" />
            </span>
            <span class="prompt-timing__count">{{ cause.count }}</span>
          </li>
        </ul>
      </section>
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
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 16px;
  padding: 18px;
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
.prompt-timing__causes {
  margin: 0 18px 18px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.prompt-timing__causes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}
.prompt-timing__causes-header h4 {
  margin: 0;
  font: inherit;
  color: var(--text-secondary);
}
.prompt-timing__causes ul {
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.prompt-timing__cause {
  display: grid;
  grid-template-columns: minmax(80px, 30%) 1fr 32px;
  align-items: center;
  gap: 12px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
.prompt-timing__cause-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prompt-timing__bar {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-muted);
  overflow: hidden;
}
.prompt-timing__bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--warning-fg);
}
.prompt-timing__count {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
