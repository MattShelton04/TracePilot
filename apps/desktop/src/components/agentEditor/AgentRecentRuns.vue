<script setup lang="ts">
/**
 * Recent runs. Each opens the session's Conversation tab at the tool call
 * that launched the run, where the existing subagent panel takes over —
 * the Agents page never becomes a second agent browser.
 */
import type { AgentRunOutcome, AgentRunRecord } from "@tracepilot/types";
import { formatDuration, formatNumber, formatRelativeTime, StatusPill } from "@tracepilot/ui";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

defineProps<{ runs: AgentRunRecord[] }>();

const router = useRouter();

const OUTCOME_TONE: Record<AgentRunOutcome, "success" | "danger" | "warning" | "neutral"> = {
  completed: "success",
  failed: "danger",
  cancelled: "warning",
  incomplete: "neutral",
};

function open(run: AgentRunRecord) {
  const query: Record<string, string> = { turn: String(run.turnIndex) };
  if (run.eventIndex != null) query.event = String(run.eventIndex);
  pushRoute(router, ROUTE_NAMES.sessionConversation, {
    params: { id: run.sessionId },
    query,
  });
}
</script>

<template>
  <ul v-if="runs.length" class="runs">
    <li v-for="run in runs" :key="`${run.sessionId}-${run.runKey}`" class="runs__row">
      <button type="button" class="runs__open" @click="open(run)">
        <StatusPill :tone="OUTCOME_TONE[run.outcome]" :label="run.outcome" size="xs" />
        <span class="runs__summary">
          {{ run.sessionSummary || run.description || run.sessionId }}
        </span>
        <span class="runs__meta">
          <span v-if="run.repository">{{ run.repository }}</span>
          <span v-if="run.model" class="runs__model">{{ run.model }}</span>
          <span v-if="run.durationMs != null">{{ formatDuration(run.durationMs) }}</span>
          <span v-if="run.totalToolCalls != null">{{ formatNumber(run.totalToolCalls) }} tools</span>
          <span v-if="run.depth > 0">depth {{ run.depth }}</span>
          <span v-if="run.startedAt">{{ formatRelativeTime(run.startedAt) }}</span>
        </span>
      </button>
      <p v-if="run.errorText" class="runs__error" :title="run.errorText">{{ run.errorText }}</p>
    </li>
  </ul>
  <p v-else class="runs__empty">No runs recorded in this range.</p>
</template>

<style scoped>
.runs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.runs__open {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.runs__open:hover {
  border-color: var(--border-accent, var(--accent-fg));
}

.runs__summary {
  flex: 1;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.runs__meta {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.runs__model {
  font-family: var(--font-mono);
}

.runs__error {
  margin: 2px 0 0 28px;
  font-size: 0.625rem;
  color: var(--danger-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.runs__empty {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
