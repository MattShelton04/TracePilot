<script setup lang="ts">
import {
  Badge,
  formatArgsSummary,
  formatDuration,
  formatTime,
  toolIcon,
  truncateText,
} from "@tracepilot/ui";
import { computed } from "vue";
import type { WaterfallRow } from "@/composables/useWaterfallLayout";

const props = defineProps<{
  row: WaterfallRow;
}>();

const displayName = computed(() => {
  const tc = props.row.call;
  if (tc.isSubagent && tc.agentDisplayName) return tc.agentDisplayName;
  return tc.toolName;
});

const argsSummary = computed(() => formatArgsSummary(props.row.call.arguments, props.row.call.toolName));
</script>

<template>
  <div class="wf-tooltip">
    <div class="tip-header">
      <span class="tip-icon">{{ toolIcon(row.call.toolName) }}</span>
      <strong>{{ displayName }}</strong>
      <Badge v-if="row.call.success === false" variant="danger">failed</Badge>
      <Badge v-else-if="row.call.success === true" variant="success">ok</Badge>
    </div>

    <div v-if="argsSummary" class="tip-args">
      {{ truncateText(argsSummary, 200) }}
    </div>

    <div v-if="row.call.intentionSummary" class="tip-args" style="font-style: italic;">
      💭 {{ row.call.intentionSummary }}
    </div>

    <div class="tip-meta">
      <span v-if="row.call.durationMs != null">
        Duration: {{ formatDuration(row.call.durationMs) }}
      </span>
      <span v-if="row.call.startedAt">
        Start: {{ formatTime(row.call.startedAt) }}
      </span>
      <span v-if="row.call.completedAt">
        End: {{ formatTime(row.call.completedAt) }}
      </span>
      <span v-if="row.call.mcpServerName">
        MCP: {{ row.call.mcpServerName }}
      </span>
    </div>

    <div v-if="row.call.error" class="tip-error">
      {{ truncateText(row.call.error, 300) }}
    </div>
  </div>
</template>
