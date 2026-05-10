<!--
  @slots
    spark — custom sparkline override (otherwise rendered from `spark` array prop)
    info  — custom info icon target (uses native title tooltip otherwise)
  Single metric tile. Compose inside <KPIRow> for hairline framing.
  See 02-primitives.md §KPI (CC-4).
-->
<script setup lang="ts">
import { ArrowDown, ArrowUp, Info, Minus } from "lucide-vue-next";
import { computed } from "vue";
import { formatBytes, formatDuration, formatNumber, formatPercent } from "../utils/formatters";

export type KPIDelta = {
  value: number;
  direction: "up" | "down" | "flat";
  tone?: "good" | "bad" | "neutral";
};

export interface KPIProps {
  label: string;
  value: string | number;
  /** Suffix unit shown after value (e.g. 'tokens', 'ms'). */
  unit?: string;
  /** When set, value (number) is formatted via the matching formatter. */
  format?: "number" | "duration" | "bytes" | "percent" | "currency";
  delta?: KPIDelta;
  /** Last N data points for the inline 64×16 sparkline. */
  spark?: number[];
  /** Shown via native `title` on the (i) icon. */
  description?: string;
  state?: "idle" | "loading" | "empty" | "error";
  density?: "comfortable" | "compact";
}

const props = withDefaults(defineProps<KPIProps>(), {
  state: "idle",
  density: "comfortable",
});

const formattedValue = computed(() => {
  if (typeof props.value === "string") return props.value;
  if (!props.format || props.format === "number") return formatNumber(props.value);
  if (props.format === "duration") return formatDuration(props.value);
  if (props.format === "bytes") return formatBytes(props.value);
  if (props.format === "percent") return formatPercent(props.value);
  if (props.format === "currency") return `$${formatNumber(props.value)}`;
  return String(props.value);
});

const deltaTone = computed<"good" | "bad" | "neutral">(() => {
  if (!props.delta) return "neutral";
  if (props.delta.tone) return props.delta.tone;
  if (props.delta.direction === "up") return "good";
  if (props.delta.direction === "down") return "bad";
  return "neutral";
});

const deltaArrowComponent = computed(() => {
  if (!props.delta) return null;
  if (props.delta.direction === "up") return ArrowUp;
  if (props.delta.direction === "down") return ArrowDown;
  return Minus;
});

const sparkPoints = computed(() => {
  if (!props.spark || props.spark.length === 0) return "";
  const w = 64;
  const h = 16;
  const pad = 1;
  const xs = props.spark;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const range = max - min || 1;
  const step = xs.length > 1 ? (w - pad * 2) / (xs.length - 1) : 0;
  return xs
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
});
</script>

<template>
  <div
    data-tp-component="KPI"
    class="kpi"
    :class="[`kpi--${density}`, `kpi--${state}`]"
  >
    <div class="kpi__label">
      <span>{{ label }}</span>
      <span
        v-if="description"
        class="kpi__info"
        :title="description"
        aria-label="More info"
      ><Info :size="12" :stroke-width="1.5" aria-hidden="true" /></span>
    </div>
    <div class="kpi__value">
      <span class="kpi__value-num">{{ formattedValue }}</span>
      <span v-if="unit" class="kpi__unit">{{ unit }}</span>
    </div>
    <div v-if="delta || spark || $slots.spark" class="kpi__row">
      <span
        v-if="delta"
        class="kpi__delta"
        :class="`kpi__delta--${deltaTone}`"
      >
        <component
          :is="deltaArrowComponent"
          v-if="deltaArrowComponent"
          :size="12"
          :stroke-width="1.5"
          aria-hidden="true"
        />
        <span>{{ Math.abs(delta.value).toFixed(1) }}%</span>
      </span>
      <slot name="spark">
        <svg
          v-if="spark && spark.length > 1"
          class="kpi__spark"
          viewBox="0 0 64 16"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline :points="sparkPoints" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.kpi {
  padding: 12px 16px;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi--compact {
  padding: 8px 12px;
}

.kpi__label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  display: flex;
  gap: 4px;
  align-items: center;
}

.kpi__info {
  color: var(--text-tertiary);
  cursor: help;
  display: inline-flex;
  align-items: center;
}

.kpi__value {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
  font-size: 22px;
  line-height: 28px;
  color: var(--text-primary);
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.kpi__unit {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: var(--font-family);
}

.kpi__row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 16px;
}

.kpi__delta {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
}

.kpi__delta--good { color: var(--success-fg); }
.kpi__delta--bad { color: var(--danger-fg); }
.kpi__delta--neutral { color: var(--text-tertiary); }

.kpi__spark {
  width: 64px;
  height: 16px;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.kpi--loading .kpi__value-num,
.kpi--empty .kpi__value-num {
  color: var(--text-tertiary);
}
</style>
