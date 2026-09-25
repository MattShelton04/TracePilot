<script setup lang="ts">
/**
 * ReadAgentRenderer — renders a `read_agent` result as a status card and a
 * conversation thread.
 *
 * The CLI returns a metadata line (status, type, model, elapsed time, turns,
 * current intent) followed by the worker's turns. Each follow-up turn names
 * the message that started it — from the parent, or `[Message from <id>]`
 * for another agent — and the worker's response. Older results carry the
 * output directly. Unrecognized output falls back to Markdown.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { toolArgString } from "@tracepilot/types";
import { CornerDownRight, Inbox } from "lucide-vue-next";
import { computed, ref } from "vue";
import {
  formatAgentAge,
  MAIN_AGENT_KEY,
  parseReadAgentResult,
  proseHint,
} from "../../utils/agentComms";
import AgentChip from "../agentComms/AgentChip.vue";
import AgentStatusPill from "../agentComms/AgentStatusPill.vue";
import MarkdownContent from "../MarkdownContent.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{ "load-full": [] }>();

/** Turns shown before "show earlier turns" — the latest turns matter most. */
const VISIBLE_TURNS = 3;

const read = computed(() => parseReadAgentResult(props.content));
const reader = computed(() => props.tc.parentToolCallId ?? MAIN_AGENT_KEY);
const worker = computed(
  () =>
    read.value?.agentId ||
    toolArgString(props.args, "agent_id") ||
    toolArgString(props.args, "agent_name"),
);

const showAllTurns = ref(false);
const hiddenTurnCount = computed(() =>
  showAllTurns.value ? 0 : Math.max(0, (read.value?.turns.length ?? 0) - VISIBLE_TURNS),
);
const visibleTurns = computed(() => read.value?.turns.slice(hiddenTurnCount.value) ?? []);

const meta = computed(() => {
  const r = read.value;
  if (!r) return [];
  const items: string[] = [];
  if (r.agentType) items.push(r.agentType);
  if (r.model) items.push(r.model);
  const seconds = r.durationSeconds ?? r.elapsedSeconds;
  if (seconds != null) items.push(formatAgentAge(seconds));
  if (r.totalTurns != null) items.push(`${r.totalTurns} ${r.totalTurns === 1 ? "turn" : "turns"}`);
  if (r.toolCallsCompleted != null) items.push(`${r.toolCallsCompleted} tool calls`);
  return items;
});

const readOptions = computed(() => {
  const options: string[] = [];
  const timeout = props.args.timeout;
  if (props.args.wait === true) {
    options.push(typeof timeout === "number" ? `waited ≤ ${timeout}s` : "waited");
  }
  if (typeof props.args.since_turn === "number")
    options.push(`since turn ${props.args.since_turn}`);
  return options;
});

const shellStatus = computed(() => {
  if (props.tc.success === false) return "error" as const;
  const status = read.value?.status;
  if (status === "failed") return "error" as const;
  if (status === "cancelled") return "cancelled" as const;
  if (status === "running" || status === "pending") return "pending" as const;
  return "success" as const;
});
</script>

<template>
  <RendererShell
    tool-name="Read agent"
    :status="shellStatus"
    :primary-hint="proseHint(readOptions.join(' · '))"
    :copy-text="content"
  >
    <template #icon><Inbox :size="16" /></template>

    <div v-if="read" class="ra-body">
      <div class="ra-header">
        <AgentChip v-if="worker" :identifier="worker" size="md" />
        <AgentStatusPill :status="read.status" />
        <span class="ra-headline">{{ read.headline }}</span>
      </div>
      <div v-if="meta.length || read.description" class="ra-meta">
        <span v-if="read.description" class="ra-description">{{ read.description }}</span>
        <span v-for="item in meta" :key="item" class="ra-meta-item">{{ item }}</span>
      </div>
      <p v-if="read.currentIntent" class="ra-intent">
        <span class="ra-label">Current intent</span> {{ read.currentIntent }}
      </p>
      <p v-if="read.timedOut" class="ra-note">
        The read returned before the agent finished; its result arrives in a later read or notification.
      </p>

      <button
        v-if="hiddenTurnCount > 0"
        type="button"
        class="ra-show-earlier"
        @click="showAllTurns = true"
      >
        Show {{ hiddenTurnCount }} earlier {{ hiddenTurnCount === 1 ? "turn" : "turns" }}
      </button>

      <ol v-if="visibleTurns.length" class="ra-turns">
        <li v-for="turn in visibleTurns" :key="turn.index" class="ra-turn">
          <div class="ra-turn-label">Turn {{ turn.index }}</div>
          <div v-if="turn.message" class="ra-inbound">
            <div class="ra-inbound-from">
              <span class="ra-label">Message from</span>
              <AgentChip
                v-if="turn.message.fromAgentId"
                :identifier="turn.message.fromAgentId"
              />
              <AgentChip v-else :identifier="reader" fallback-label="Parent agent" />
            </div>
            <MarkdownContent :content="turn.message.content" :render="true" class="ra-text" />
          </div>
          <div class="ra-response">
            <CornerDownRight v-if="turn.message" :size="12" class="ra-response-icon" aria-hidden="true" />
            <MarkdownContent
              v-if="turn.response"
              :content="turn.response"
              :render="true"
              class="ra-text"
            />
            <span v-else class="ra-empty">No text response — the agent replied through tools.</span>
          </div>
        </li>
      </ol>

      <MarkdownContent v-if="read.body" :content="read.body" :render="true" class="ra-text ra-legacy" />
    </div>

    <MarkdownContent v-else :content="content" :render="true" class="ra-fallback" />
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.ra-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
}
.ra-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ra-headline {
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.ra-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}
.ra-description {
  color: var(--text-secondary);
}
.ra-label {
  color: var(--text-tertiary);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ra-intent,
.ra-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.ra-note {
  color: var(--text-tertiary);
  font-style: italic;
}
.ra-show-earlier {
  align-self: flex-start;
  padding: 2px 10px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  cursor: pointer;
}
.ra-show-earlier:hover {
  background: var(--neutral-subtle);
}
.ra-turns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ra-turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-muted);
}
.ra-turn-label {
  color: var(--text-tertiary);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ra-inbound {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-left: 2px solid var(--done-fg);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
}
.ra-inbound-from {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ra-response {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.ra-response-icon {
  flex-shrink: 0;
  margin-top: 4px;
  color: var(--text-tertiary);
}
.ra-text {
  min-width: 0;
  font-size: 0.8125rem;
}
.ra-empty {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-style: italic;
}
.ra-legacy,
.ra-fallback {
  padding: 4px 0;
}
.ra-fallback {
  padding: 10px 12px;
}
</style>
