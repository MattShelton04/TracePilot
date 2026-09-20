<script setup lang="ts">
/**
 * Inline trend sparkline over a zero-filled series of daily counts.
 * Purely decorative: the figures it summarises are always shown as text
 * next to it, so it carries an `aria-label` and no other semantics.
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** One value per day, oldest first. */
    values: number[];
    label: string;
    width?: number;
    height?: number;
    tone?: "accent" | "success" | "warning" | "danger" | "neutral";
  }>(),
  { width: 96, height: 22, tone: "accent" },
);

const PAD = 1.5;

/** A flat series still gets a visible line, drawn mid-height. */
const path = computed(() => {
  const values = props.values;
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const inner = props.height - PAD * 2;
  const step = values.length > 1 ? (props.width - PAD * 2) / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = PAD + index * step;
      const y = max > 0 ? props.height - PAD - (value / max) * inner : props.height / 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
});

const area = computed(() =>
  path.value && props.values.length > 1
    ? `${path.value} L${(props.width - PAD).toFixed(1)} ${props.height - PAD} L${PAD} ${props.height - PAD} Z`
    : "",
);
</script>

<template>
  <svg
    v-if="path"
    class="usage-sparkline"
    :class="`usage-sparkline--${tone}`"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    role="img"
    :aria-label="label"
    preserveAspectRatio="none"
  >
    <path v-if="area" class="usage-sparkline__area" :d="area" />
    <path class="usage-sparkline__line" :d="path" />
  </svg>
</template>

<style scoped>
.usage-sparkline {
  display: block;
  overflow: visible;
  color: var(--accent-fg);
}

.usage-sparkline--success {
  color: var(--success-fg);
}

.usage-sparkline--warning {
  color: var(--warning-fg);
}

.usage-sparkline--danger {
  color: var(--danger-fg);
}

.usage-sparkline--neutral {
  color: var(--neutral-fg);
}

.usage-sparkline__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.usage-sparkline__area {
  fill: currentColor;
  opacity: 0.12;
  stroke: none;
}
</style>
