<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  value: string | number;
  label: string;
  color?: "accent" | "success" | "warning" | "danger" | "done";
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  gradient?: boolean;
  mini?: boolean;
  tooltip?: string;
  /**
   * `plain` suppresses the default value color class so consumers can apply
   * their own color via `customValueClass` or an external stylesheet.
   */
  variant?: "default" | "plain";
  /** When set, renders a left-border accent in this color. */
  accentColor?: string;
  /** Extra class applied to the value element (for gradients etc). */
  customValueClass?: string;
  /**
   * `uppercase` applies uppercase labels with slightly wider tracking —
   * useful for consumers migrating from hand-rolled "stat chip" layouts.
   */
  labelStyle?: "default" | "uppercase";
}>();

const rootStyle = computed<Record<string, string> | undefined>(() => {
  if (!props.accentColor) return undefined;
  return { borderLeft: `3px solid ${props.accentColor}` };
});

const valueClasses = computed(() => {
  const classes: string[] = [];
  if (props.gradient) {
    classes.push("gradient-value");
  } else if (props.variant !== "plain") {
    classes.push(props.color ?? "accent");
  }
  if (props.customValueClass) classes.push(props.customValueClass);
  return classes;
});
</script>

<template>
  <div
    class="stat-card"
    :class="{ 'mini-stat': mini }"
    :style="rootStyle"
    :title="tooltip"
  >
    <div class="stat-card-value" :class="valueClasses">
      {{ value }}
    </div>
    <div
      class="stat-card-label"
      :class="{ 'stat-card-label--uppercase': labelStyle === 'uppercase' }"
    >
      {{ label }}
    </div>
    <div
      v-if="trend"
      class="stat-card-trend"
      :class="trendDirection ?? 'neutral'"
    >
      <span v-if="trendDirection === 'up'" aria-hidden="true">↑</span>
      <span v-else-if="trendDirection === 'down'" aria-hidden="true">↓</span>
      {{ trend }}
    </div>
  </div>
</template>

<style scoped>
.stat-card-label--uppercase {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.75rem;
}
</style>
