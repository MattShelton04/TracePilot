<script setup lang="ts">
import type { ContextToolTypeContribution } from "@tracepilot/types";
import { computed, ref } from "vue";

const props = defineProps<{
  items: ContextToolTypeContribution[];
}>();

const colors = [
  "var(--chart-primary)",
  "var(--chart-secondary)",
  "var(--chart-warning)",
  "var(--chart-success)",
  "var(--chart-danger)",
  "var(--chart-info)",
];
const hoveredLabel = ref<string | null>(null);
const chartSvg = ref<SVGSVGElement | null>(null);

const segments = computed(() => {
  const visible = props.items.slice(0, 5).map((item, index) => ({
    label: item.toolName,
    percentage: item.percentage,
    tokens: item.totalTokens,
    calls: item.callCount,
    argumentTokens: item.argumentTokens,
    resultTokens: item.resultTokens,
    color: colors[index],
  }));
  const other = props.items.slice(5);
  if (other.length) {
    visible.push({
      label: "Other",
      percentage: other.reduce((sum, item) => sum + item.percentage, 0),
      tokens: other.reduce((sum, item) => sum + item.totalTokens, 0),
      calls: other.reduce((sum, item) => sum + item.callCount, 0),
      argumentTokens: other.reduce((sum, item) => sum + item.argumentTokens, 0),
      resultTokens: other.reduce((sum, item) => sum + item.resultTokens, 0),
      color: colors[5],
    });
  }
  let offset = 0;
  return visible.map((item) => {
    const segment = { ...item, offset };
    offset += item.percentage;
    return segment;
  });
});

const hovered = computed(() => segments.value.find((item) => item.label === hoveredLabel.value));

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

function handleChartPointerMove(event: MouseEvent) {
  const svg = chartSvg.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 42 - 21;
  const y = ((event.clientY - rect.top) / rect.height) * 42 - 21;
  const radius = Math.hypot(x, y);
  if (radius < 11.2 || radius > 20.6) {
    hoveredLabel.value = null;
    return;
  }

  const clockwiseFromTop = ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360;
  const percentage = clockwiseFromTop / 3.6;
  hoveredLabel.value =
    segments.value.find(
      (item) => percentage >= item.offset && percentage < item.offset + item.percentage,
    )?.label ?? null;
}
</script>

<template>
  <div class="tool-donut">
    <div class="tool-donut__chart">
      <svg
        ref="chartSvg"
        viewBox="0 0 42 42"
        role="img"
        aria-label="Tool contribution donut chart"
        @mousemove="handleChartPointerMove"
        @mouseleave="hoveredLabel = null"
      >
        <rect width="42" height="42" fill="transparent" />
        <circle
          cx="21"
          cy="21"
          r="15.9155"
          fill="none"
          stroke="var(--border-muted)"
          stroke-width="9"
        />
        <g transform="rotate(-90 21 21)">
          <circle
            v-for="item in segments"
            :key="item.label"
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            :stroke="item.color"
            :stroke-width="hoveredLabel === item.label ? 10 : 9"
            pathLength="100"
            :stroke-dasharray="`${item.percentage} ${100 - item.percentage}`"
            :stroke-dashoffset="-item.offset"
            class="tool-donut__segment"
            tabindex="0"
            role="img"
            :aria-label="`${item.label}: ${item.percentage.toFixed(1)}%, ${formatTokens(item.tokens)} estimated tokens`"
            @focus="hoveredLabel = item.label"
            @blur="hoveredLabel = null"
          />
        </g>
        <template v-if="hovered">
          <text x="21" y="20" text-anchor="middle" class="tool-donut__center-value">
            {{ hovered.percentage.toFixed(1) }}%
          </text>
          <text x="21" y="24" text-anchor="middle">{{ hovered.label }}</text>
        </template>
        <template v-else>
          <text x="21" y="20" text-anchor="middle">Tool</text>
          <text x="21" y="24" text-anchor="middle">input</text>
        </template>
      </svg>

      <div v-if="hovered" class="tool-donut__tooltip" role="tooltip">
        <strong>{{ hovered.label }}</strong>
        <span>{{ hovered.percentage.toFixed(1) }}% · {{ formatTokens(hovered.tokens) }} tokens</span>
        <small>
          {{ hovered.calls }} calls · {{ formatTokens(hovered.argumentTokens) }} arguments ·
          {{ formatTokens(hovered.resultTokens) }} results
        </small>
      </div>
    </div>

    <div class="tool-donut__legend">
      <div
        v-for="item in segments"
        :key="item.label"
        tabindex="0"
        @mouseenter="hoveredLabel = item.label"
        @mouseleave="hoveredLabel = null"
        @focus="hoveredLabel = item.label"
        @blur="hoveredLabel = null"
      >
        <span class="tool-donut__swatch" :style="{ background: item.color }" />
        <strong>{{ item.label }}</strong>
        <span>{{ item.percentage.toFixed(1) }}%</span>
        <small>{{ formatTokens(item.tokens) }} estimated tokens</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-donut {
  display: grid;
  grid-template-columns: minmax(150px, 0.85fr) minmax(180px, 1.15fr);
  align-items: center;
  gap: 24px;
  min-height: 240px;
}

.tool-donut__chart {
  position: relative;
  width: min(100%, 230px);
  padding-bottom: 48px;
  margin: auto;
}

.tool-donut svg {
  display: block;
  width: 100%;
  overflow: visible;
}

.tool-donut__segment {
  cursor: help;
  outline: none;
  transition: opacity 120ms ease, stroke-width 120ms ease;
}

.tool-donut__segment:focus,
.tool-donut__segment:hover {
  filter: brightness(1.12);
}

.tool-donut text {
  fill: var(--text-secondary);
  font-size: 2.25px;
  font-weight: 650;
  pointer-events: none;
}

.tool-donut .tool-donut__center-value {
  fill: var(--text-primary);
  font-size: 3px;
}

.tool-donut__tooltip {
  position: absolute;
  z-index: var(--z-tooltip);
  bottom: 2px;
  left: 50%;
  display: grid;
  width: max-content;
  max-width: 260px;
  gap: 2px;
  padding: 7px 9px;
  transform: translateX(-50%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-overlay);
  box-shadow: var(--shadow-md);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  pointer-events: none;
}

.tool-donut__tooltip strong {
  color: var(--text-primary);
}

.tool-donut__tooltip small {
  color: var(--text-tertiary);
}

.tool-donut__legend {
  display: grid;
  gap: 8px;
}

.tool-donut__legend > div {
  display: grid;
  grid-template-columns: 9px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 3px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  outline: none;
}

.tool-donut__legend > div:hover,
.tool-donut__legend > div:focus {
  background: var(--neutral-subtle);
}

.tool-donut__legend strong {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-donut__legend small {
  grid-column: 2 / -1;
  margin-top: -5px;
  color: var(--text-tertiary);
}

.tool-donut__swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

@media (max-width: 640px) {
  .tool-donut {
    grid-template-columns: 1fr;
    padding-bottom: 48px;
  }
}
</style>
