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
    :class="tc.success === false ? 'border-[var(--color-danger-fg)]/20' : 'border-[var(--color-border-muted)]'"
  >
    <!-- Clickable header -->
    <button
      class="w-full flex items-center gap-3 text-left transition-colors hover:bg-[var(--color-sidebar-hover)]"
      :class="[
        tc.success === false ? 'bg-[var(--color-danger-muted)]' : 'bg-[var(--color-canvas-subtle)]',
        variant === 'compact' ? 'px-3 py-2 text-xs' : 'px-4 py-2.5',
      ]"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="text-sm flex-shrink-0">{{ toolIcon(tc.toolName) }}</span>

      <span class="font-semibold text-sm" :class="categoryColor(toolCategory(tc.toolName))">
        {{ tc.toolName }}
      </span>

      <span
        v-if="summary"
        class="text-xs text-[var(--color-text-tertiary)] truncate max-w-[300px] font-mono"
        :title="summary"
      >
        {{ summary }}
      </span>

      <span v-if="tc.mcpServerName" class="text-xs text-[var(--color-text-tertiary)]">
        via {{ tc.mcpServerName }}{{ tc.mcpToolName ? ` → ${tc.mcpToolName}` : "" }}
      </span>

      <span class="ml-auto flex items-center gap-2 flex-shrink-0">
        <span v-if="tc.durationMs" class="text-xs text-[var(--color-text-tertiary)] tabular-nums">
          {{ formatDuration(tc.durationMs) }}
        </span>

        <!-- Success/fail indicator -->
        <span v-if="tc.success === true" class="h-4 w-4 rounded-full bg-[var(--color-success-muted)] flex items-center justify-center">
          <svg class="h-2.5 w-2.5 text-[var(--color-success-fg)]" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
          </svg>
        </span>
        <span v-else-if="tc.success === false" class="h-4 w-4 rounded-full bg-[var(--color-danger-muted)] flex items-center justify-center">
          <svg class="h-2.5 w-2.5 text-[var(--color-danger-fg)]" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </span>
        <span v-else class="h-4 w-4 rounded-full bg-[var(--color-neutral-muted)] flex items-center justify-center">
          <span class="text-[10px] text-[var(--color-text-tertiary)]">○</span>
        </span>

        <ExpandChevron :expanded="expanded" />
      </span>
    </button>

    <!-- Expandable detail -->
    <ToolCallDetail v-if="expanded" :tc="tc" />
  </div>
</template>
