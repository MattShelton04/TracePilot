<script setup lang="ts">
import type { TurnSessionEvent, TurnToolCall } from "@tracepilot/types";
import { computed, nextTick, ref, watch } from "vue";
import { formatDuration } from "../utils/formatters";
import { categoryColor, formatArgsSummary, toolCategory, toolIcon } from "../utils/toolCall";
import ExpandChevron from "./ExpandChevron.vue";
import ToolCallDetail from "./ToolCallDetail.vue";

const props = defineProps<{
  tc: TurnToolCall;
  argsSummary?: string;
  expanded: boolean;
  /** "full" = clickable row with chevron; "compact" = small row */
  variant?: "full" | "compact";
  /** Full (un-truncated) tool result, loaded on demand. */
  fullResult?: string;
  /** Whether the full result is currently being loaded. */
  loadingFullResult?: boolean;
  /** Whether the full result load has failed. */
  failedFullResult?: boolean;
  /** Whether rich rendering is enabled for this tool (default: true). */
  richEnabled?: boolean;
  /** Permission events paired to this tool call by `toolCallId`. When
   *  present, the row renders a small permission status pill (approved /
   *  denied / pending / hook) so the tool call and the permission prompt
   *  read as a single linked record instead of two adjacent timeline
   *  rows. Optional — older sessions and tool calls without a paired
   *  prompt simply omit this prop. */
  permission?: {
    requested?: TurnSessionEvent;
    completed?: TurnSessionEvent;
  };
}>();

const emit = defineEmits<{
  toggle: [];
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
}>();

const summary = computed(
  () => props.argsSummary ?? formatArgsSummary(props.tc.arguments, props.tc.toolName),
);

// ── Permission pill (paired permission.* events, when provided) ───
type PermissionStatus = "approved" | "denied" | "pending" | "hook" | "unknown";

const permissionStatus = computed<PermissionStatus | null>(() => {
  const perm = props.permission;
  if (!perm) return null;
  if (!perm.requested && !perm.completed) return null;
  if (perm.requested?.resolvedByHook && !perm.completed) return "hook";
  const kind = perm.completed?.resultKind;
  if (!kind) return "pending";
  if (kind.startsWith("approved")) return "approved";
  if (kind.startsWith("denied")) return "denied";
  return "unknown";
});

const permissionLabel = computed(() => {
  switch (permissionStatus.value) {
    case "approved":
      return props.permission?.completed?.resultKind ?? "approved";
    case "denied":
      return props.permission?.completed?.resultKind ?? "denied";
    case "pending":
      return "permission pending";
    case "hook":
      return "resolved by hook";
    case "unknown":
      return props.permission?.completed?.resultKind ?? "permission";
    default:
      return "";
  }
});

const permissionIcon = computed(() => {
  switch (permissionStatus.value) {
    case "approved":
      return "🔓";
    case "denied":
      return "🔒";
    case "pending":
      return "⏳";
    case "hook":
      return "🪝";
    default:
      return "🔐";
  }
});

const permissionTooltip = computed(() => {
  const perm = props.permission;
  if (!perm) return "";
  const parts: string[] = [];
  const kind = perm.requested?.promptKind;
  if (kind) parts.push(`prompt: ${kind}`);
  if (perm.requested?.summary) parts.push(perm.requested.summary);
  if (perm.completed?.summary) parts.push(perm.completed.summary);
  return parts.join("\n");
});

// ── Keep expanded detail in view ───────────────────────────────────
// When the user expands a tool-call detail, the newly-revealed content can
// extend past the scroll container's viewport. If the header is currently
// visible (user is looking at this row), nudge the container so the detail
// fits. If the user is scrolled far away, do nothing — don't fight them.
const rootEl = ref<HTMLElement | null>(null);

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur && cur !== document.body) {
    const style = getComputedStyle(cur);
    if (/auto|scroll|overlay/.test(style.overflowY)) {
      if (cur.scrollHeight > cur.clientHeight) return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

watch(
  () => props.expanded,
  (val, prev) => {
    // Only on a genuine false → true transition (user-initiated expand).
    if (!val || prev) return;
    void nextTick(() => {
      const root = rootEl.value;
      if (!root) return;
      const container = findScrollContainer(root);
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const eRect = root.getBoundingClientRect();
      // User is scrolled far away from this row — leave their scroll alone.
      if (eRect.bottom < cRect.top || eRect.top > cRect.bottom) return;
      // Expanded content doesn't extend past the bottom — nothing to do.
      if (eRect.bottom <= cRect.bottom) return;
      const overflow = eRect.bottom - cRect.bottom + 8;
      container.scrollBy({ top: overflow, behavior: "smooth" });
    });
  },
);
</script>

<template>
  <div
    ref="rootEl"
    class="rounded-lg border overflow-hidden"
    :style="
      permissionStatus === 'denied'
        ? 'border-color: var(--danger-muted);'
        : tc.success === false
          ? 'border-color: var(--danger-muted);'
          : 'border-color: var(--border-muted);'
    "
  >
    <!-- Clickable header -->
    <button
      type="button"
      class="tool-call-item w-full text-left"
      :style="
        permissionStatus === 'denied'
          ? 'background: var(--danger-muted);'
          : tc.success === false
            ? 'background: var(--danger-muted);'
            : ''
      "
      :class="variant === 'compact' ? 'text-xs' : ''"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="tool-call-icon">{{ toolIcon(tc.toolName) }}</span>

      <!-- With intention: stacked name + intent -->
      <template v-if="tc.intentionSummary">
        <span class="tool-call-name-group">
          <span class="tool-call-name" :class="categoryColor(toolCategory(tc.toolName))">
            {{ tc.toolName }}
          </span>
          <span class="tool-call-intent" :title="tc.intentionSummary">
            {{ tc.intentionSummary }}
          </span>
        </span>
      </template>

      <!-- Without intention: flat layout -->
      <template v-else>
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
      </template>

      <span v-if="tc.mcpServerName" class="tool-call-args">
        via {{ tc.mcpServerName }}{{ tc.mcpToolName ? ` → ${tc.mcpToolName}` : "" }}
      </span>

      <span class="ml-auto flex items-center gap-2 flex-shrink-0">
        <!-- Permission status pill (paired permission.* events) -->
        <span
          v-if="permissionStatus"
          :class="['tool-call-permission-pill', `status-${permissionStatus}`]"
          :title="permissionTooltip"
        >
          <span aria-hidden="true">{{ permissionIcon }}</span>
          <span class="tool-call-permission-label">{{ permissionLabel }}</span>
        </span>

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
    <ToolCallDetail
      v-if="expanded"
      :tc="tc"
      :full-result="fullResult"
      :loading-full-result="loadingFullResult"
      :failed-full-result="failedFullResult"
      :rich-enabled="richEnabled"
      @load-full-result="emit('load-full-result', $event)"
      @retry-full-result="emit('retry-full-result', $event)"
    />
  </div>
</template>

<style scoped>
.tool-call-permission-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.18);
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
}

.tool-call-permission-pill .tool-call-permission-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-call-permission-pill.status-approved {
  color: var(--success-fg, #3fb950);
}

.tool-call-permission-pill.status-denied {
  color: var(--danger-fg, #f85149);
}

.tool-call-permission-pill.status-pending {
  color: var(--warning-fg, #d29922);
}

.tool-call-permission-pill.status-hook {
  color: var(--accent-fg, #58a6ff);
}

.tool-call-permission-pill.status-unknown {
  color: var(--text-secondary, #8b949e);
}
</style>
