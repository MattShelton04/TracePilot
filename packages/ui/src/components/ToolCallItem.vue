<script setup lang="ts">
import { computed } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import { formatDuration } from "../utils/formatters";
import { toolIcon, toolCategory, categoryColor, formatArgsSummary } from "../utils/toolCall";
import ExpandChevron from "./ExpandChevron.vue";
import ToolCallDetail from "./ToolCallDetail.vue";

const props = defineProps<{
  tc: TurnToolCall;
  argsSummary?: string;
  expanded: boolean;
  /** "full" = clickable row with chevron; "compact" = small row */
  variant?: "full" | "compact";
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const summary = computed(() => props.argsSummary ?? formatArgsSummary(props.tc.arguments, props.tc.toolName));
</script>

<template>
  <div
    class="rounded-lg border overflow-hidden"
    :style="tc.success === false ? 'border-color: var(--danger-muted);' : 'border-color: var(--border-muted);'"
  >
    <!-- Clickable header -->
    <button
      type="button"
      class="tool-call-item w-full text-left"
      :style="tc.success === false ? 'background: var(--danger-muted);' : ''"
      :class="variant === 'compact' ? 'text-xs' : ''"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="tool-call-icon">{{ toolIcon(tc.toolName) }}</span>

      <span class="tool-call-name" :class="categoryColor(toolCategory(tc.toolName))">
        {{ tc.toolName }}
      </span>

      <span
        v-if="summary"
        class="tool-call-args font-mono"
        :title="summary"
      >
        {{ summary }}
      </span>

      <span v-if="tc.mcpServerName" class="tool-call-args">
        via {{ tc.mcpServerName }}{{ tc.mcpToolName ? ` → ${tc.mcpToolName}` : "" }}
      </span>

      <span class="ml-auto flex items-center gap-2 flex-shrink-0">
        <span v-if="tc.durationMs" class="tool-call-duration">
          {{ formatDuration(tc.durationMs) }}
        </span>

        <!-- Success/fail indicator -->
        <span v-if="tc.success === true" class="tool-call-status success">✓</span>
        <span v-else-if="tc.success === false" class="tool-call-status failed">✗</span>
        <span v-else class="tool-call-status" style="color: var(--text-tertiary);">○</span>

        <ExpandChevron :expanded="expanded" />
      </span>
    </button>

    <!-- Expandable detail -->
    <ToolCallDetail v-if="expanded" :tc="tc" />
  </div>
</template>
