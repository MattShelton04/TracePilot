<script setup lang="ts">
import { ChartTooltip, useChartTooltip } from "@tracepilot/ui";
import { computed } from "vue";
import { type HeatmapEntry, localizeHeatmap } from "@/utils/analytics";

const props = defineProps<{
  entries: readonly HeatmapEntry[];
}>();

const { tooltip, dismissTooltip, onBarMouseEnter } = useChartTooltip();

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabels = Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? `${i}:00` : ""));

const heatmapData = computed<number[][]>(() => {
  const localOffsetMinutes = -new Date().getTimezoneOffset();
  return localizeHeatmap([...props.entries], localOffsetMinutes);
});

const heatmapMax = computed(() => {
  let max = 1;
  for (const row of heatmapData.value) {
    for (const val of row) {
      if (val > max) max = val;
    }
  }
  return max;
});

function getHeatmapColor(val: number): string {
  if (val === 0) return "var(--heatmap-empty, rgba(99, 102, 241, 0.04))";
  const intensity = Math.min(val / heatmapMax.value, 1);
  const opacity = 0.1 + intensity * 0.8;
  return `rgba(99, 102, 241, ${opacity.toFixed(2)})`;
}

function getHeatmapLegendColor(level: number): string {
  const opacity = 0.1 + (level / 5) * 0.8;
  return `rgba(99, 102, 241, ${opacity.toFixed(2)})`;
}
</script>

<template>
  <div class="section-panel tool-heatmap mb-4">
    <div class="section-panel-header">Activity Heatmap</div>
    <div class="section-panel-body tooltip-area" @mouseleave="dismissTooltip">
      <div class="tool-heatmap__grid">
        <div class="tool-heatmap__row tool-heatmap__row--hours">
          <span class="tool-heatmap__label" />
          <span
            v-for="(label, hourIdx) in hourLabels"
            :key="`h-${hourIdx}`"
            class="tool-heatmap__hour"
          >{{ label }}</span>
        </div>
        <div
          v-for="(row, dayIdx) in heatmapData"
          :key="dayIdx"
          class="tool-heatmap__row"
        >
          <span class="tool-heatmap__label">{{ dayLabels[dayIdx] }}</span>
          <div
            v-for="(val, hourIdx) in row"
            :key="hourIdx"
            class="tool-heatmap__cell"
            :style="{ backgroundColor: getHeatmapColor(val) }"
            @mouseenter="onBarMouseEnter($event, `${dayLabels[dayIdx]} ${String(hourIdx).padStart(2, '0')}:00 — ${val} tool call${val !== 1 ? 's' : ''}`, 'heatmap')"
          >
            <span v-if="val > 0" class="tool-heatmap__count">{{ val }}</span>
          </div>
        </div>
        <div class="tool-heatmap__legend">
          <span>Less</span>
          <div
            v-for="level in 5"
            :key="level"
            class="tool-heatmap__cell tool-heatmap__cell--legend"
            :style="{ backgroundColor: getHeatmapLegendColor(level) }"
          />
          <span>More</span>
        </div>
      </div>
      <ChartTooltip :tooltip="tooltip" chart-id="heatmap" />
    </div>
  </div>
</template>

<style scoped>
.tool-heatmap__grid {
  overflow-x: auto;
}

.tool-heatmap__row {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 3px;
}

.tool-heatmap__row--hours {
  margin-bottom: 6px;
}

.tool-heatmap__hour {
  width: 28px;
  flex-shrink: 0;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-align: center;
}

.tool-heatmap__label {
  width: 40px;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: right;
  padding-right: 8px;
  font-weight: 500;
}

.tool-heatmap__cell {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: outline 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.tool-heatmap__cell:hover {
  outline: 2px solid var(--accent-fg);
  outline-offset: -1px;
  z-index: 1;
}

.tool-heatmap__count {
  font-size: 0.5625rem;
  font-weight: 600;
  color: var(--text-on-emphasis);
  pointer-events: none;
}

.tool-heatmap__legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  padding-left: 48px;
}

.tool-heatmap__cell--legend {
  width: 20px;
  height: 20px;
  cursor: default;
}

.tool-heatmap__cell--legend:hover {
  outline: none;
}
</style>
