<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ModelTooltipState } from "@/composables/modelComparison/useModelChartTooltip";

const props = defineProps<{ tooltip: ModelTooltipState }>();

const OFFSET = 14;
const MARGIN = 8;
const el = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);

watch(
  () => [props.tooltip.visible, props.tooltip.x, props.tooltip.y, props.tooltip.content],
  async () => {
    if (!props.tooltip.visible) return;
    await nextTick();
    const box = el.value;
    if (!box) return;
    const { x, y } = props.tooltip;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    // Prefer below-right of the pointer; flip when that would leave the window.
    left.value = x + OFFSET + w > window.innerWidth - MARGIN ? x - OFFSET - w : x + OFFSET;
    top.value = y + OFFSET + h > window.innerHeight - MARGIN ? y - OFFSET - h : y + OFFSET;
    left.value = Math.max(MARGIN, left.value);
    top.value = Math.max(MARGIN, top.value);
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tooltip.visible && tooltip.content"
      ref="el"
      role="tooltip"
      class="model-chart-tooltip"
      :style="{ left: `${left}px`, top: `${top}px` }"
    >
      <div class="model-chart-tooltip-title">
        <span
          v-if="tooltip.content.color"
          class="model-chart-tooltip-swatch"
          :class="{ hollow: tooltip.content.hollow }"
          :style="{ '--swatch': tooltip.content.color }"
        />
        <span>{{ tooltip.content.title }}</span>
      </div>
      <div v-for="row in tooltip.content.rows" :key="row.label" class="model-chart-tooltip-row">
        <span class="model-chart-tooltip-label">
          <span v-if="row.color" class="model-chart-tooltip-swatch" :style="{ '--swatch': row.color }" />
          {{ row.label }}
        </span>
        <span class="model-chart-tooltip-value">{{ row.value }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.model-chart-tooltip {
  position: fixed;
  z-index: var(--z-tooltip);
  pointer-events: none;
  min-width: 180px;
  max-width: min(22rem, calc(100vw - 16px));
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--chart-tooltip-bg) 82%, white 18%);
  border-radius: 8px;
  background: var(--chart-tooltip-bg);
  color: var(--chart-tooltip-fg);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
  font-size: 0.6875rem;
  line-height: 1.5;
}

.model-chart-tooltip-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.model-chart-tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.model-chart-tooltip-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: color-mix(in srgb, var(--chart-tooltip-fg) 62%, transparent);
}

.model-chart-tooltip-value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.model-chart-tooltip-swatch {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--swatch);
}

.model-chart-tooltip-swatch.hollow {
  background: transparent;
  box-shadow: inset 0 0 0 2px var(--swatch);
}
</style>
