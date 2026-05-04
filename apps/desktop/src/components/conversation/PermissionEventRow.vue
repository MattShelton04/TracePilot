<script setup lang="ts">
/**
 * PermissionEventRow renders a `permission.requested` event together
 * with its matching `permission.completed` event (paired by `requestId`)
 * as a single linked card.
 *
 * Rationale: in CLI v1.0.40 schemas, permission prompts are surfaced as
 * a request/response pair on the session event stream. Showing them as
 * two adjacent generic rows ("Permission requested ..." / "Permission result ...")
 * is noisy and hides the obvious link. This component collapses them into
 * one row with a status pill.
 *
 * If only the `requested` half is present (still pending, or `completed`
 * landed in a later turn / outside the session window), the row renders
 * with a `pending` pill. If only `completed` is present, it renders the
 * result on its own; defensively, we never want to drop a known event.
 */
import type { TurnSessionEvent } from "@tracepilot/types";
import { formatTime } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  /** The `permission.requested` event, if observed. */
  requested?: TurnSessionEvent;
  /** The `permission.completed` event, if observed. */
  completed?: TurnSessionEvent;
}>();

type Status = "approved" | "denied" | "pending" | "hook" | "unknown";

const status = computed<Status>(() => {
  if (props.requested?.resolvedByHook && !props.completed) return "hook";
  const kind = props.completed?.resultKind;
  if (!kind) return "pending";
  if (kind.startsWith("approved")) return "approved";
  if (kind.startsWith("denied")) return "denied";
  return "unknown";
});

const statusIcon = computed(() => {
  switch (status.value) {
    case "approved":
      return "✓";
    case "denied":
      return "✗";
    case "pending":
      return "⏳";
    case "hook":
      return "🪝";
    default:
      return "?";
  }
});

const statusLabel = computed(() => {
  switch (status.value) {
    case "approved":
      return props.completed?.resultKind ?? "approved";
    case "denied":
      return props.completed?.resultKind ?? "denied";
    case "pending":
      return "pending";
    case "hook":
      return "resolved by hook";
    default:
      return props.completed?.resultKind ?? "unknown";
  }
});

const promptKind = computed(() => props.requested?.promptKind);

/**
 * Free-text intention surfaced from the requested summary. The Rust
 * reconstructor formats it as `Permission requested (<kind>): <intention>`,
 * so we strip that prefix for cleaner display. Fallback to the raw summary
 * if the prefix doesn't match (defensive).
 */
const intention = computed(() => {
  const summary = props.requested?.summary;
  if (!summary) return null;
  const colon = summary.indexOf("):");
  if (colon !== -1 && summary.startsWith("Permission requested")) {
    return summary.slice(colon + 2).trim();
  }
  return summary;
});

/**
 * Free-text feedback surfaced from the completed summary. Format is
 * `Permission result: <kind> (<feedback>)`; strip the prefix and the
 * trailing parens to expose just the feedback when present.
 */
const feedback = computed(() => {
  const summary = props.completed?.summary;
  if (!summary) return null;
  const open = summary.indexOf("(");
  const close = summary.lastIndexOf(")");
  if (open !== -1 && close > open) {
    return summary.slice(open + 1, close).trim();
  }
  return null;
});

const timestamp = computed(() => props.completed?.timestamp ?? props.requested?.timestamp);

const tooltip = computed(() => {
  const reqId = props.requested?.requestId ?? props.completed?.requestId;
  const toolId = props.completed?.toolCallId ?? props.requested?.toolCallId;
  const parts: string[] = [];
  if (reqId) parts.push(`requestId: ${reqId}`);
  if (toolId) parts.push(`toolCallId: ${toolId}`);
  return parts.join("\n");
});
</script>

<template>
  <div :class="['cv-permission-event', `status-${status}`]" :title="tooltip">
    <span class="cv-permission-icon" aria-hidden="true">🔐</span>

    <span v-if="promptKind" class="cv-permission-kind">{{ promptKind }}</span>

    <span class="cv-permission-intention">
      <template v-if="intention">{{ intention }}</template>
      <template v-else-if="completed && !requested">
        {{ completed.summary }}
      </template>
      <template v-else>Permission prompt</template>
    </span>

    <span :class="['cv-permission-status', `status-${status}`]">
      <span class="cv-permission-status-icon" aria-hidden="true">{{ statusIcon }}</span>
      <span class="cv-permission-status-label">{{ statusLabel }}</span>
    </span>

    <span v-if="feedback" class="cv-permission-feedback" :title="feedback">
      "{{ feedback }}"
    </span>

    <span v-if="timestamp" class="cv-permission-time">
      {{ formatTime(timestamp) }}
    </span>
  </div>
</template>

<style scoped>
.cv-permission-event {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  margin: 4px 0;
  border-left: 3px solid var(--neutral-muted, rgba(110, 118, 129, 0.4));
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.08));
  color: var(--text-secondary, #8b949e);
}

.cv-permission-event.status-approved {
  border-left-color: var(--success-fg, #3fb950);
  background: var(--success-subtle, rgba(63, 185, 80, 0.08));
}

.cv-permission-event.status-denied {
  border-left-color: var(--danger-fg, #f85149);
  background: var(--danger-subtle, rgba(248, 81, 73, 0.08));
}

.cv-permission-event.status-pending {
  border-left-color: var(--warning-fg, #d29922);
  background: var(--warning-subtle, rgba(210, 153, 34, 0.08));
}

.cv-permission-event.status-hook {
  border-left-color: var(--accent-fg, #58a6ff);
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
}

.cv-permission-icon {
  flex-shrink: 0;
}

.cv-permission-kind {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid var(--neutral-muted, rgba(110, 118, 129, 0.4));
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  text-transform: lowercase;
  color: var(--text-secondary, #8b949e);
}

.cv-permission-intention {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #e6edf3);
}

.cv-permission-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 10px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.15);
}

.cv-permission-status.status-approved {
  color: var(--success-fg, #3fb950);
}

.cv-permission-status.status-denied {
  color: var(--danger-fg, #f85149);
}

.cv-permission-status.status-pending {
  color: var(--warning-fg, #d29922);
}

.cv-permission-status.status-hook {
  color: var(--accent-fg, #58a6ff);
}

.cv-permission-status.status-unknown {
  color: var(--text-secondary, #8b949e);
}

.cv-permission-feedback {
  flex-shrink: 1;
  min-width: 0;
  max-width: 35%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  opacity: 0.85;
}

.cv-permission-time {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.6;
}
</style>
