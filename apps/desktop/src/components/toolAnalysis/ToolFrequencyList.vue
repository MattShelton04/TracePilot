<script setup lang="ts">
import type { ToolUsageEntry } from "@tracepilot/types";
import { formatNumberFull } from "@tracepilot/types";
import { useChartTooltip } from "@tracepilot/ui";

defineProps<{
  tools: readonly ToolUsageEntry[];
  maxInvocations: number;
}>();

const { tooltip, dismissTooltip, onBarMouseEnter } = useChartTooltip();
</script>

<template>
  <div class="section-panel tool-frequency">
    <div class="section-panel-header">Tool Frequency</div>
    <div
      class="section-panel-body scrollable-section tooltip-area"
      @mouseleave="dismissTooltip"
    >
      <div class="tool-frequency__chart">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="tool-frequency__row"
          @mouseenter="onBarMouseEnter($event, `${tool.name} — ${formatNumberFull(tool.callCount)} invocation${tool.callCount !== 1 ? 's' : ''}`, 'frequency')"
        >
          <span class="tool-frequency__label">{{ tool.name }}</span>
          <div class="tool-frequency__track">
            <div
              class="tool-frequency__bar"
              :style="{ width: (tool.callCount / (maxInvocations || 1) * 100) + '%' }"
            />
          </div>
          <span class="tool-frequency__count">{{ formatNumberFull(tool.callCount) }}</span>
        </div>
      </div>
      <div
        v-if="tooltip.visible && tooltip.chartId === 'frequency'"
        class="chart-tooltip"
        :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
        :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
      >{{ tooltip.content }}</div>
    </div>
  </div>
</template>

<style scoped>
.scrollable-section {
  max-height: 400px;
  overflow-y: auto;
}

.tool-frequency__chart {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.tool-frequency__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.tool-frequency__row:last-child {
  border-bottom: none;
}

.tool-frequency__label {
  width: 80px;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.tool-frequency__track {
  flex: 1;
  height: 8px;
  background: var(--neutral-muted);
  border-radius: 4px;
  overflow: hidden;
}

.tool-frequency__bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--chart-primary), var(--chart-primary-light));
  transition: width 0.3s ease;
}

.tool-frequency__count {
  width: 36px;
  text-align: right;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
