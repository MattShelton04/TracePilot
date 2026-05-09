<!--
  @slots
    (no slots — pure presentational primitive)
  Canonical "% of context / budget used" indicator. Replaces ad-hoc
  `.token-bar` reinventions across the app. See 02-primitives.md
  §TokenBudgetBar (CC-7).
-->
<script setup lang="ts">
import { computed } from "vue";

export interface TokenBudgetBarThresholds {
  warn: number;
  danger: number;
}

export interface TokenBudgetBarProps {
  used: number;
  total: number;
  /** 0..1, default { warn: 0.75, danger: 0.90 }. */
  thresholds?: TokenBudgetBarThresholds;
  /** Default: "Context window". */
  label?: string;
  /** Optional right-side sublabel (e.g. model name). */
  sublabel?: string;
  /** Default true: "X / Y" — set false to suppress the ratio. */
  showRatio?: boolean;
  /** Default true: " (Z %)" — set false to suppress percentage. */
  showPercent?: boolean;
  /** sm = 4px bar, md = 6px (default). */
  size?: "sm" | "md";
  state?: "idle" | "loading" | "error";
}

const props = withDefaults(defineProps<TokenBudgetBarProps>(), {
  thresholds: () => ({ warn: 0.75, danger: 0.9 }),
  label: "Context window",
  showRatio: true,
  showPercent: true,
  size: "md",
  state: "idle",
});

const ratio = computed(() => {
  if (!props.total || props.total <= 0) return 0;
  return Math.max(0, Math.min(1, props.used / props.total));
});

const percent = computed(() => Math.round(ratio.value * 1000) / 10);

const tone = computed<"ok" | "warn" | "danger">(() => {
  if (ratio.value >= props.thresholds.danger) return "danger";
  if (ratio.value >= props.thresholds.warn) return "warn";
  return "ok";
});

const fillStyle = computed(() => ({
  width: `${ratio.value * 100}%`,
}));

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

const valueText = computed(
  () => `${fmt(props.used)} of ${fmt(props.total)} tokens used (${percent.value} percent)`,
);
</script>

<template>
  <div
    data-tp-component="TokenBudgetBar"
    class="tbb"
    :class="[`tbb--${size}`, `tbb--${tone}`, { 'tbb--loading': state === 'loading', 'tbb--error': state === 'error' }]"
  >
    <div class="tbb__hdr">
      <span class="tbb__label">{{ label }}</span>
      <span v-if="showRatio || showPercent || sublabel" class="tbb__hdr-right">
        <span v-if="showRatio" class="tbb__hdr--num">{{ fmt(used) }} / {{ fmt(total) }}</span>
        <span v-if="showPercent" class="tbb__hdr--num tbb__hdr--pct">({{ percent }} %)</span>
        <span v-if="sublabel" class="tbb__sublabel">{{ sublabel }}</span>
      </span>
    </div>
    <div
      class="tbb__track"
      role="progressbar"
      :aria-label="label"
      :aria-valuenow="Math.round(ratio * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuetext="valueText"
    >
      <div class="tbb__fill" :style="fillStyle" />
    </div>
  </div>
</template>

<style scoped>
.tbb {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tbb__hdr {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
}

.tbb__label {
  font-weight: 500;
}

.tbb__hdr-right {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
}

.tbb__hdr--num {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
  color: var(--text-primary);
}

.tbb__sublabel {
  color: var(--text-tertiary);
}

.tbb__track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  overflow: hidden;
}

.tbb--sm .tbb__track {
  height: 4px;
}

.tbb__fill {
  height: 100%;
  transition: width 180ms cubic-bezier(0.2, 0.6, 0.2, 1), background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.tbb--ok .tbb__fill { background: var(--success-fg); }
.tbb--warn .tbb__fill { background: var(--warning-fg); }
.tbb--danger .tbb__fill { background: var(--danger-fg); }

.tbb--ok .tbb__hdr--pct { color: var(--success-fg); }
.tbb--warn .tbb__hdr--pct { color: var(--warning-fg); }
.tbb--danger .tbb__hdr--pct { color: var(--danger-fg); }

.tbb--loading .tbb__fill { background: var(--surface-tertiary); }
.tbb--error .tbb__fill { background: var(--danger-fg); }

@media (prefers-reduced-motion: reduce) {
  .tbb__fill { transition: none; }
}
</style>
