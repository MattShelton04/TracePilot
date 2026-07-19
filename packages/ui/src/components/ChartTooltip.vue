<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ChartTooltipState } from "../composables/useChartTooltip";

const props = defineProps<{
  tooltip: ChartTooltipState;
  chartId: string;
}>();

const GAP = 8;
const VIEWPORT_MARGIN = 8;

const tooltipElement = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);
const placement = ref<"above" | "below">("above");

const isVisible = computed(() => props.tooltip.visible && props.tooltip.chartId === props.chartId);

function updatePosition() {
  const element = tooltipElement.value;
  if (!element || typeof window === "undefined") return;

  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const minX = VIEWPORT_MARGIN + width / 2;
  const maxX = window.innerWidth - VIEWPORT_MARGIN - width / 2;

  left.value =
    minX <= maxX ? Math.min(Math.max(props.tooltip.x, minX), maxX) : window.innerWidth / 2;

  const fitsAbove = props.tooltip.y - GAP - height >= VIEWPORT_MARGIN;
  placement.value = fitsAbove ? "above" : "below";
  top.value = fitsAbove ? props.tooltip.y - GAP : props.tooltip.y + GAP;
}

watch(
  () => [isVisible.value, props.tooltip.content, props.tooltip.x, props.tooltip.y],
  async () => {
    if (!isVisible.value) return;
    await nextTick();
    updatePosition();
  },
  { immediate: true },
);

onMounted(() => window.addEventListener("resize", updatePosition));
onBeforeUnmount(() => window.removeEventListener("resize", updatePosition));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isVisible"
      ref="tooltipElement"
      role="tooltip"
      class="chart-tooltip"
      :class="[
        `chart-tooltip--${placement}`,
        { 'chart-tooltip--pinned': tooltip.pinned },
      ]"
      :style="{ left: `${left}px`, top: `${top}px` }"
    >{{ tooltip.content }}</div>
  </Teleport>
</template>

<style scoped>
.chart-tooltip {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  width: max-content;
  max-width: min(28rem, calc(100vw - 16px));
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--chart-tooltip-bg) 82%, white 18%);
  border-radius: 6px;
  background: var(--chart-tooltip-bg, rgba(24, 24, 27, 0.94));
  color: var(--chart-tooltip-fg);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
  text-align: center;
  white-space: normal;
  z-index: var(--z-tooltip);
}

.chart-tooltip--above {
  transform: translate(-50%, -100%);
}

.chart-tooltip--below {
  transform: translateX(-50%);
}

.chart-tooltip--pinned {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-fg) var(--chart-active-emphasis, 28%), transparent),
    0 3px 12px rgba(0, 0, 0, 0.22);
}
</style>
