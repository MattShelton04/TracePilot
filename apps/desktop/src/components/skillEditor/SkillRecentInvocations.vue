<script setup lang="ts">
/**
 * Recent invocations. Each opens the session's Conversation tab at the turn
 * that loaded the skill, where the existing skill row takes over — the Skills
 * page never becomes a second conversation browser.
 */
import type { SkillInvocationRecord } from "@tracepilot/types";
import { formatNumber, formatRelativeTime } from "@tracepilot/ui";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

defineProps<{ invocations: SkillInvocationRecord[] }>();

const router = useRouter();

function open(record: SkillInvocationRecord) {
  pushRoute(router, ROUTE_NAMES.sessionConversation, {
    params: { id: record.sessionId },
    query: { turn: String(record.turnIndex), event: String(record.eventIndex) },
  });
}

/** What the CLI recorded, or an honest "unknown" for older versions. */
function triggerLabel(record: SkillInvocationRecord): string {
  if (record.trigger === "user-invoked") return "you";
  if (record.trigger === "agent-invoked") return "the model";
  return "trigger unknown";
}
</script>

<template>
  <ul v-if="invocations.length" class="invocations">
    <li
      v-for="record in invocations"
      :key="`${record.sessionId}-${record.eventIndex}`"
      class="invocations__row"
    >
      <button type="button" class="invocations__open" @click="open(record)">
        <span
          class="invocations__summary"
          :title="record.sessionSummary || record.sessionId"
        >{{ record.sessionSummary || record.sessionId }}</span>
        <span class="invocations__meta">
          <span>{{ triggerLabel(record) }}</span>
          <span v-if="record.agentName">via {{ record.agentName }}</span>
          <span v-if="record.repository">{{ record.repository }}</span>
          <span v-if="record.model" class="invocations__model">{{ record.model }}</span>
          <span v-if="record.contentTokens != null">
            ~{{ formatNumber(record.contentTokens) }} tokens
          </span>
          <span
            v-else
            title="Recorded only as a skill tool call, with no event carrying its content."
          >no content recorded</span>
          <span v-if="record.timestamp">{{ formatRelativeTime(record.timestamp) }}</span>
        </span>
      </button>
    </li>
  </ul>
  <p v-else class="invocations__empty">No invocations recorded in this range.</p>
</template>

<style scoped>
.invocations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.invocations__open {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.invocations__open:hover {
  border-color: var(--border-accent, var(--accent-fg));
}

.invocations__open:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.invocations__summary {
  min-width: 0;
  font-size: 0.75rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.invocations__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.invocations__meta > span {
  overflow-wrap: anywhere;
}

.invocations__model {
  font-family: var(--font-mono);
}

.invocations__empty {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
