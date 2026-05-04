<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import { ToolCallItem, type useToggleSet } from "@tracepilot/ui";
import {
  COLLAPSE_THRESHOLD,
  countRegularTools,
  getCollapsedToolNames,
  MAX_VISIBLE_TOOLS,
  type ToolGroupItem,
} from "@/components/conversation/chatViewUtils";
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

function shouldCollapse(items: ToolGroupItem[]): boolean {
  return countRegularTools(items) > MAX_VISIBLE_TOOLS + COLLAPSE_THRESHOLD;
}

function isItemVisible(item: ToolGroupItem, items: ToolGroupItem[], itemIndex: number): boolean {
  // Pills (intent, ask-user) are always visible
  if (item.type !== "tool") return true;
  // If group is expanded, everything visible
  if (props.expandedGroups.has(props.groupKey)) return true;
  // If no collapse needed, everything visible
  if (!shouldCollapse(items)) return true;
  // Count regular tools up to this index
  let toolIdx = 0;
  for (let i = 0; i <= itemIndex; i++) {
    if (items[i].type === "tool") toolIdx++;
  }
  return toolIdx <= MAX_VISIBLE_TOOLS;
}

function hiddenToolCount(items: ToolGroupItem[]): number {
  return countRegularTools(items) - MAX_VISIBLE_TOOLS;
}

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
        <span class="cv-pill-icon" aria-hidden="true">🎯</span>
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
      <ToolCallItem
        v-else-if="item.type === 'tool'"
        v-show="isItemVisible(item, items, iIdx)"
        :data-event-idx="item.toolCall.eventIndex != null ? item.toolCall.eventIndex : undefined"
        v-bind="tcProps(item.toolCall)"
        @toggle="toggleToolDetail(item.toolCall)"
        @load-full-result="emit('load-full-result', $event)"
        @retry-full-result="emit('retry-full-result', $event)"
      />
    </template>

    <!-- Collapse toggle -->
    <button
      v-if="shouldCollapse(items) && !expandedGroups.has(groupKey)"
      class="cv-collapsed-toggle"
      :aria-expanded="false"
      @click="expandedGroups.toggle(groupKey)"
    >
      <span class="cv-collapsed-toggle-label">
        Show {{ hiddenToolCount(items) }} more tools
      </span>
      <span class="cv-collapsed-toggle-tags">
        <span
          v-for="name in getCollapsedToolNames(items, MAX_VISIBLE_TOOLS)"
          :key="name"
          class="cv-collapsed-tag"
        >{{ name }}</span>
      </span>
    </button>

    <button
      v-if="shouldCollapse(items) && expandedGroups.has(groupKey)"
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
  color: var(--accent-fg, #58a6ff);
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
  background: var(--canvas-inset, #010409);
  border: 1px dashed var(--border-muted, #484f58);
  border-radius: var(--radius-sm, 4px);
  color: var(--accent-fg, #58a6ff);
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
  color: var(--text-tertiary, #484f58);
  white-space: nowrap;
}
</style>
