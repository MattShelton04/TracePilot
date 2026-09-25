<script setup lang="ts">
/**
 * WriteAgentRenderer — renders a `write_agent` message between agents.
 *
 * Shows who sent the message to whom (a single agent, several agents, or a
 * `siblings` / `children` broadcast), the message itself, and each
 * recipient's delivery: whether it started a new turn immediately or waited
 * in the queue of a busy agent (recorded by CLI 1.0.78+).
 */
import type { TurnToolCall } from "@tracepilot/types";
import { formatTime, toolArgString } from "@tracepilot/types";
import { Send } from "lucide-vue-next";
import { computed } from "vue";
import { useAgentDirectory } from "../../composables/useAgentDirectory";
import {
  type AgentRuntimeStatus,
  MAIN_AGENT_KEY,
  parseWriteAgentResult,
  writeAgentTarget,
} from "../../utils/agentComms";
import AgentChip from "../agentComms/AgentChip.vue";
import AgentMessageRoute from "../agentComms/AgentMessageRoute.vue";
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

const { communicationFor, resolve } = useAgentDirectory();

const message = computed(() => toolArgString(props.args, "message"));
const target = computed(() => writeAgentTarget(props.args));
const result = computed(() => parseWriteAgentResult(props.content));
const communication = computed(() => communicationFor(props.tc.toolCallId));
const sender = computed(() => props.tc.parentToolCallId ?? MAIN_AGENT_KEY);

const recipients = computed<string[]>(() => {
  if (communication.value?.toKeys.length) return communication.value.toKeys;
  if (target.value.kind === "agents") return target.value.agentIds;
  return result.value?.deliveries.map((d) => d.agentId) ?? [];
});

interface DeliveryRow {
  id: string;
  delivered: boolean;
  outcome: string;
  taskStatus?: AgentRuntimeStatus;
  queued: boolean;
  at?: string;
}

const deliveries = computed<DeliveryRow[]>(() => {
  const recorded = new Map((communication.value?.deliveries ?? []).map((d) => [d.toKey, d]));
  const logFor = (id: string) => recorded.get(resolve(id)?.key ?? id);
  const reported = result.value?.deliveries;
  if (reported?.length) {
    return reported.map((d) => ({
      id: d.agentId,
      delivered: d.delivered,
      outcome: d.outcome,
      taskStatus: d.taskStatus,
      queued: logFor(d.agentId)?.delivery === "queued",
      at: logFor(d.agentId)?.deliveredAt,
    }));
  }
  const failed = props.tc.success === false;
  return recipients.value.map((id) => ({
    id,
    delivered: !failed,
    outcome: failed ? "Not delivered" : "Delivered",
    queued: logFor(id)?.delivery === "queued",
    at: logFor(id)?.deliveredAt,
  }));
});

const status = computed(() => {
  if (props.tc.success === false) return "error" as const;
  if (deliveries.value.length && deliveries.value.every((d) => !d.delivered))
    return "error" as const;
  if (deliveries.value.some((d) => !d.delivered)) return "warning" as const;
  return "success" as const;
});

const hint = computed(() => {
  const count = recipients.value.length;
  if (target.value.kind === "scope") return `${target.value.scope} · ${count || "?"} recipients`;
  return count > 1 ? `${count} recipients` : undefined;
});
</script>

<template>
  <RendererShell
    tool-name="Agent message"
    :status="status"
    :primary-hint="hint"
    :copy-text="message || content"
  >
    <template #icon><Send :size="16" /></template>
    <div class="wa-body">
      <AgentMessageRoute
        :from="sender"
        :to="recipients"
        :scope="target.kind === 'scope' ? target.scope : undefined"
      />
      <MarkdownContent v-if="message" class="wa-message" :content="message" :render="true" />
      <ul v-if="deliveries.length" class="wa-deliveries" aria-label="Deliveries">
        <li v-for="d in deliveries" :key="d.id" class="wa-delivery">
          <AgentChip :identifier="d.id" />
          <span :class="['wa-outcome', { 'wa-outcome--failed': !d.delivered }]">
            {{ d.delivered ? (d.queued ? "Queued — recipient was busy" : "Delivered") : d.outcome }}
          </span>
          <AgentStatusPill v-if="d.taskStatus" :status="d.taskStatus" />
          <span v-if="d.at" class="wa-time" :title="d.at">{{ formatTime(d.at) }}</span>
        </li>
      </ul>
      <pre v-if="!result && content && !message" class="wa-raw">{{ content }}</pre>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.wa-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
}
.wa-message {
  padding: 8px 12px;
  border-left: 2px solid var(--done-fg);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  font-size: 0.8125rem;
}
.wa-deliveries {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.wa-delivery {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.6875rem;
}
.wa-outcome {
  color: var(--text-secondary);
}
.wa-outcome--failed {
  color: var(--danger-fg);
}
.wa-time {
  margin-left: auto;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.wa-raw {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}
</style>
