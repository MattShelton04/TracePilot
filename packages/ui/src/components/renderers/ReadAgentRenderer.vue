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
import { computed } from "vue";
import {
  formatAgentAge,
  MAIN_AGENT_KEY,
  parseReadAgentResult,
  proseHint,
} from "../../utils/agentComms";
import { toolCallStatus } from "../../utils/toolCallStatus";
import AgentChip from "../agentComms/AgentChip.vue";
import AgentStatusPill from "../agentComms/AgentStatusPill.vue";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import RecordedToolResponse from "./RecordedToolResponse.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{ "load-full": [] }>();

const read = computed(() => parseReadAgentResult(props.content));
const reader = computed(() => props.tc.parentToolCallId ?? MAIN_AGENT_KEY);
const worker = computed(
  () =>
    read.value?.agentId ||
    toolArgString(props.args, "agent_id") ||
    toolArgString(props.args, "agent_name"),
);

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

// Reading an agent can succeed while the worker is still running or has failed.
const shellStatus = computed(() => toolCallStatus(props.tc));
</script>

<template>
  <RendererShell
    tool-name="Read agent"
    :status="shellStatus"
    :primary-hint="proseHint(readOptions.join(' · '))"
    :copy-text="content"
  >
    <template #icon><Inbox :size="16" /></template>

    <RendererScrollRegion :label="read?.turns.length ? `${read.turns.length}-turn agent transcript` : 'agent response'">
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

      <ol v-if="read.turns.length" class="ra-turns">
        <li v-for="turn in read.turns" :key="turn.index" class="ra-turn">
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
      <RecordedToolResponse :content="content" />
    </div>

    <MarkdownContent v-else-if="content" :content="content" :render="true" class="ra-fallback" />
    <p v-else class="ra-fallback ra-empty">{{ shellStatus === 'pending' ? 'Waiting for agent response…' : 'No response returned.' }}</p>
    </RendererScrollRegion>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.ra-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ra-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ra-headline {
  color: var(--text-secondary);
  font-size: 13px;
}
.ra-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.ra-description {
  color: var(--text-secondary);
}
.ra-label {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 600;
}
.ra-intent,
.ra-note {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.ra-note {
  color: var(--text-tertiary);
  font-style: italic;
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
  font-size: 12px;
  font-weight: 600;
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
  flex-wrap: wrap;
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
  font-size: 13px;
  font-style: italic;
}
.ra-legacy,
.ra-fallback {
  padding: 4px 0;
}
.ra-fallback {
  margin: 0;
  padding: 12px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
