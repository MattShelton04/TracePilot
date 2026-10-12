<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import { ToolCallItem, type useToggleSet } from "@tracepilot/ui";
import { Target } from "lucide-vue-next";
import { computed } from "vue";
import {
  COLLAPSE_THRESHOLD,
  MAX_VISIBLE_TOOLS,
  type ToolGroupItem,
} from "@/components/conversation/chatViewUtils";
import SkillInvocationEventRow from "@/components/conversation/SkillInvocationEventRow.vue";
import type { PermissionPair } from "@/components/conversation/sessionEventPairing";

type ToggleSet = ReturnType<typeof useToggleSet<string>>;

interface ToolCallItemProps {
  tc: TurnToolCall;
  variant: "compact";
  argsSummary: string;
  expanded: boolean;
  fullResult: string | undefined;
  loadingFullResult: boolean;
  failedFullResult: boolean;
  richEnabled: boolean;
  permission?: PermissionPair;
}

const props = defineProps<{
  turn: ConversationTurn;
  items: ToolGroupItem[];
  groupKey: string;
  expandedGroups: ToggleSet;
  tcProps: (tc: TurnToolCall) => ToolCallItemProps;
  toggleToolDetail: (tc: TurnToolCall) => void;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
}>();

// Derive disclosure once per group update, instead of counting all tools and
// scanning a prefix for every row. All rows stay mounted for deep links and
// detail state; non-tool pills bypass this boundary and always remain visible.
const disclosure = computed(() => {
  let toolCount = 0;
  let lastVisibleIndex = -1;
  const names = new Set<string>();
  for (let index = 0; index < props.items.length; index++) {
    const item = props.items[index];
    if (item.type !== "tool") continue;
    toolCount++;
    if (toolCount <= MAX_VISIBLE_TOOLS) lastVisibleIndex = index;
    else if (names.size < 6) names.add(item.toolCall.nativeToolName ?? item.toolCall.toolName);
  }
  return {
    shouldCollapse: toolCount > MAX_VISIBLE_TOOLS + COLLAPSE_THRESHOLD,
    hiddenToolCount: toolCount - MAX_VISIBLE_TOOLS,
    lastVisibleIndex,
    names: [...names],
  };
});
const isCollapsed = computed(
  () => disclosure.value.shouldCollapse && !props.expandedGroups.has(props.groupKey),
);

// Note: uses || (not ??) so empty strings also fall through to the "…"
// placeholder — a blank display label is never desirable in the UI.
function intentLabel(tc: TurnToolCall): string {
  return toolArgString(getToolArgs(tc), "intent") || "…";
}
</script>

<template>
  <div class="cv-tool-group" :data-collapse-key="groupKey">
    <template v-for="(item, iIdx) in items" :key="iIdx">
      <!-- Intent pill -->
      <div
        v-if="item.type === 'intent'"
        class="cv-intent-pill"
        :data-event-idx="item.toolCall.eventIndex != null ? item.toolCall.eventIndex : undefined"
      >
        <span class="cv-pill-icon" aria-hidden="true"><Target :size="14" /></span>
        <span class="cv-pill-label">{{ intentLabel(item.toolCall) }}</span>
      </div>

      <!-- Read-agent row -->
      <ToolCallItem
        v-else-if="item.type === 'read-agent'"
        :data-event-idx="item.toolCall.eventIndex != null ? item.toolCall.eventIndex : undefined"
        v-bind="tcProps(item.toolCall)"
        @toggle="toggleToolDetail(item.toolCall)"
        @load-full-result="emit('load-full-result', $event)"
        @retry-full-result="emit('retry-full-result', $event)"
      />

      <!-- Ask-user (rich renderer) -->
      <ToolCallItem
        v-else-if="item.type === 'ask-user'"
        :data-event-idx="item.toolCall.eventIndex != null ? item.toolCall.eventIndex : undefined"
        v-bind="tcProps(item.toolCall)"
        @toggle="toggleToolDetail(item.toolCall)"
        @load-full-result="emit('load-full-result', $event)"
        @retry-full-result="emit('retry-full-result', $event)"
      />

      <!-- Regular tool row (with progressive disclosure) -->
      <SkillInvocationEventRow
        v-else-if="item.type === 'tool' && item.toolCall.toolName === 'skill' && item.toolCall.skillInvocation"
        v-show="!isCollapsed || iIdx <= disclosure.lastVisibleIndex"
        :data-event-idx="item.toolCall.eventIndex != null ? item.toolCall.eventIndex : undefined"
        :tool-call="item.toolCall"
      />

      <ToolCallItem
        v-else-if="item.type === 'tool'"
        v-show="!isCollapsed || iIdx <= disclosure.lastVisibleIndex"
        :data-event-idx="item.toolCall.eventIndex != null ? item.toolCall.eventIndex : undefined"
        v-bind="tcProps(item.toolCall)"
        @toggle="toggleToolDetail(item.toolCall)"
        @load-full-result="emit('load-full-result', $event)"
        @retry-full-result="emit('retry-full-result', $event)"
      />
    </template>

    <!-- Collapse toggle -->
    <button
      v-if="isCollapsed"
      class="cv-collapsed-toggle"
      :aria-expanded="false"
      @click="expandedGroups.toggle(groupKey)"
    >
      <span class="cv-collapsed-toggle-label">
        Show {{ disclosure.hiddenToolCount }} more tools
      </span>
      <span class="cv-collapsed-toggle-tags">
        <span
          v-for="name in disclosure.names"
          :key="name"
          class="cv-collapsed-tag"
        >{{ name }}</span>
      </span>
    </button>

    <button
      v-if="disclosure.shouldCollapse && !isCollapsed"
      class="cv-collapsed-toggle"
      :aria-expanded="true"
      @click="expandedGroups.toggle(groupKey)"
    >
      <span class="cv-collapsed-toggle-label">Show fewer tools</span>
    </button>
  </div>
</template>

<style scoped>
.cv-tool-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0;
}

/* ─── Intent pill ──────────────────────────────────────────────── */

.cv-intent-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.2));
  border-radius: var(--radius-full, 100px);
  font-size: 12px;
  color: var(--accent-fg);
  max-width: 100%;
  margin: 2px 0;
}

.cv-intent-pill .cv-pill-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.cv-intent-pill .cv-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Collapse toggle ──────────────────────────────────────────── */

.cv-collapsed-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border: 1px dashed var(--border-muted);
  border-radius: var(--radius-sm, 4px);
  color: var(--accent-fg);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition-fast, 0.1s) ease;
}

.cv-collapsed-toggle:hover {
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
}

.cv-collapsed-toggle-label {
  white-space: nowrap;
  font-weight: 500;
}

.cv-collapsed-toggle-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}

.cv-collapsed-tag {
  display: inline-block;
  padding: 1px 6px;
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  border-radius: var(--radius-sm, 4px);
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
