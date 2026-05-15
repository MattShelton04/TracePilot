<script setup lang="ts">
import type { ToolUsageEntry } from "@tracepilot/types";
import { formatDuration, formatNumberFull, formatRate } from "@tracepilot/types";

defineProps<{
  tools: readonly ToolUsageEntry[];
}>();
</script>

<template>
  <div class="section-panel tool-usage-list mb-4">
    <div class="section-panel-header">Tool Usage Breakdown</div>
    <div class="section-panel-body scrollable-section tool-usage-list__body">
      <table class="data-table tool-usage-list__table" aria-label="Tool usage breakdown">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Invocations</th>
            <th>Success Rate</th>
            <th>Avg Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tool in tools" :key="tool.name">
            <td class="tool-usage-list__name">{{ tool.name }}</td>
            <td class="tabular-nums">{{ formatNumberFull(tool.callCount) }}</td>
            <td>
              <div class="tabular-nums">{{ formatRate(tool.successRate) }}</div>
              <div class="progress-bar tool-usage-list__success-bar">
                <div class="progress-bar-fill" :style="{ width: formatRate(tool.successRate) }" />
              </div>
            </td>
            <td class="tabular-nums">{{ formatDuration(tool.avgDurationMs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.tool-usage-list__body {
  padding: 0;
}

.tool-usage-list__name {
  font-weight: 600;
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.tool-usage-list__success-bar {
  margin-top: 4px;
  width: 120px;
}

.scrollable-section {
  max-height: 400px;
  overflow-y: auto;
}

.tool-usage-list__table tbody tr:hover {
  background: var(--neutral-muted, rgba(99, 102, 241, 0.06));
}
</style>
