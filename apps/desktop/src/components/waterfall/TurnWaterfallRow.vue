<script setup lang="ts">
import {
  Badge,
  categoryColor,
  ExpandChevron,
  formatArgsSummary,
  getToolCallColor,
  toolCategory,
  toolIcon,
  truncateText,
} from "@tracepilot/ui";
import { computed } from "vue";
import type { WaterfallRow } from "@/composables/useWaterfallLayout";

const props = defineProps<{
  row: WaterfallRow;
  selected: boolean;
  hovered: boolean;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: "select"): void;
  (e: "toggle-expanded"): void;
  (e: "hover-enter"): void;
  (e: "hover-leave"): void;
}>();

const displayName = computed(() => {
  const tc = props.row.call;
  if (tc.isSubagent && tc.agentDisplayName) return tc.agentDisplayName;
  return tc.toolName;
});

const argsSummary = computed(() => formatArgsSummary(props.row.call.arguments, props.row.call.toolName));

const barStyle = computed(() => ({
  left: `${props.row.leftPct}%`,
  width: `${Math.min(Math.max(props.row.widthPct, 0.4), 100 - props.row.leftPct)}%`,
  background: getToolCallColor(props.row.call),
  opacity: props.row.call.isSubagent ? 0.35 : 0.85,
}));
</script>

<template>
  <div
    class="wf-row"
    :class="{
      selected,
      hovered,
      child: row.depth > 0,
      subagent: row.call.isSubagent,
    }"
    @click="emit('select')"
    @keydown.enter.space.prevent="emit('select')"
    @mouseenter="emit('hover-enter')"
    @mouseleave="emit('hover-leave')"
    tabindex="0"
    role="button"
    :aria-label="displayName"
  >
    <!-- Left label column -->
    <div class="label-col" :style="{ paddingLeft: row.depth * 16 + 'px' }">
      <!-- Expand chevron for subagents -->
      <button
        v-if="row.call.isSubagent && row.call.toolCallId"
        class="expand-btn"
        @click.stop="emit('toggle-expanded')"
        :aria-expanded="expanded"
        aria-label="Toggle children"
      >
        <ExpandChevron :expanded="expanded" size="sm" />
      </button>

      <!-- Tree connector for children -->
      <span v-if="row.depth > 0" class="tree-line">└</span>

      <!-- Icon -->
      <span class="tool-icon">{{ toolIcon(row.call.toolName) }}</span>

      <!-- Name + summary -->
      <span class="tool-name" :class="categoryColor(toolCategory(row.call.toolName))">
        {{ displayName }}
      </span>

      <span v-if="row.call.isSubagent" class="agent-tag">(agent)</span>

      <Badge v-if="row.isParallel" variant="accent">parallel</Badge>

      <span v-if="row.call.success === false" class="fail-mark">✕</span>

      <span class="args-summary">
        {{ truncateText(argsSummary, 40) }}
      </span>
    </div>

    <!-- Right bar column -->
    <div class="bar-col">
      <div class="bar" :style="barStyle" />
    </div>
  </div>
</template>
