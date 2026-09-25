<script setup lang="ts">
/**
 * SubagentMessageItem — one inter-agent message in a subagent's activity
 * stream: a message it received (from its parent or another agent) or one it
 * sent with `write_agent` (to agents, or to all siblings/children).
 */
import { formatTime } from "@tracepilot/types";
import { ArrowDownLeft, ArrowUpRight } from "lucide-vue-next";
import { computed, ref } from "vue";
import type { AgentCommDelivery, AgentCommunication } from "../../utils/agentComms";
import AgentChip from "../agentComms/AgentChip.vue";
import MarkdownContent from "../MarkdownContent.vue";

const props = defineProps<{
  direction: "in" | "out";
  communication: AgentCommunication;
  /** The recipient's delivery record, for received messages. */
  delivery?: AgentCommDelivery;
  renderMarkdown: boolean;
}>();

/** Long messages start collapsed; the first lines are usually enough. */
const COLLAPSE_THRESHOLD = 480;

const expanded = ref(false);
const collapsible = computed(() => props.communication.content.length > COLLAPSE_THRESHOLD);

const queuedCount = computed(
  () => props.communication.deliveries.filter((d) => d.delivery === "queued").length,
);

const time = computed(() =>
  props.direction === "in"
    ? (props.delivery?.deliveredAt ?? props.communication.at)
    : props.communication.at,
);
</script>

<template>
  <div
    :class="['sap-msg', `sap-msg--${direction}`, { 'sap-msg--peer': communication.relation === 'peer' }]"
    :data-sap-tool-call-id="communication.toolCallId ?? undefined"
  >
    <div class="sap-msg-header">
      <ArrowDownLeft v-if="direction === 'in'" :size="13" class="sap-msg-icon" aria-hidden="true" />
      <ArrowUpRight v-else :size="13" class="sap-msg-icon" aria-hidden="true" />
      <span class="sap-msg-label">{{ direction === "in" ? "Message from" : "Sent to" }}</span>
      <template v-if="direction === 'in'">
        <AgentChip :identifier="communication.fromKey" />
      </template>
      <template v-else>
        <span v-if="communication.scope" class="sap-msg-scope">all {{ communication.scope }}</span>
        <AgentChip v-for="key in communication.toKeys" :key="key" :identifier="key" />
      </template>
      <span v-if="communication.relation === 'peer'" class="sap-msg-relation" title="Between agents in different branches, such as siblings">peer</span>
      <span v-if="direction === 'in' && delivery?.delivery === 'queued'" class="sap-msg-badge" title="Arrived while this agent was busy; processed after its current work">
        queued
      </span>
      <span v-if="direction === 'out' && queuedCount" class="sap-msg-badge" title="Recipients that were busy when the message arrived">
        {{ queuedCount }} queued
      </span>
      <span v-if="communication.failed" class="sap-msg-badge sap-msg-badge--failed">not delivered</span>
      <span v-if="time" class="sap-msg-time" :title="time">{{ formatTime(time) }}</span>
    </div>
    <div :class="['sap-msg-body', { 'sap-msg-body--clamped': collapsible && !expanded }]">
      <MarkdownContent :content="communication.content" :render="renderMarkdown" />
    </div>
    <button
      v-if="collapsible"
      type="button"
      class="sap-msg-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? "Show less" : "Show full message" }}
    </button>
  </div>
</template>

<style scoped>
.sap-msg {
  --sap-msg-accent: var(--done-fg);
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0;
  padding: 8px 10px;
  border: 1px solid var(--border-muted);
  border-left: 3px solid var(--sap-msg-accent);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
}
.sap-msg--out {
  --sap-msg-accent: var(--accent-fg);
}
.sap-msg--peer {
  --sap-msg-accent: var(--attention-fg);
}
.sap-msg-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
}
.sap-msg-icon {
  flex-shrink: 0;
  color: var(--sap-msg-accent);
}
.sap-msg-label {
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 600;
}
.sap-msg-scope,
.sap-msg-relation,
.sap-msg-badge {
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.sap-msg-scope {
  color: var(--text-secondary);
}
.sap-msg-badge {
  background: var(--attention-subtle);
  color: var(--attention-fg);
}
.sap-msg-badge--failed {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}
.sap-msg-time {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}
.sap-msg-body {
  font-size: 0.8125rem;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.sap-msg-body--clamped {
  max-height: 7.5em;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 60%, transparent);
}
.sap-msg-toggle {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-fg);
  font-size: 0.6875rem;
  cursor: pointer;
}
.sap-msg-toggle:hover {
  text-decoration: underline;
}
</style>
