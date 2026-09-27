<script setup lang="ts">
/**
 * WriteAgentArgsRenderer — a `write_agent` message before its result arrives:
 * the route and the message text.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { toolArgString } from "@tracepilot/types";
import { computed } from "vue";
import { MAIN_AGENT_KEY, writeAgentTarget } from "../../utils/agentComms";
import { toolCallStatus } from "../../utils/toolCallStatus";
import AgentMessageRoute from "../agentComms/AgentMessageRoute.vue";
import MarkdownContent from "../MarkdownContent.vue";
import RendererScrollRegion from "../RendererScrollRegion.vue";

const props = defineProps<{
  args: Record<string, unknown>;
  tc: TurnToolCall;
}>();

const target = computed(() => writeAgentTarget(props.args));
const message = computed(() => toolArgString(props.args, "message"));
const status = computed(() => toolCallStatus(props.tc));
</script>

<template>
  <RendererScrollRegion label="agent message"><div class="wa-args">
    <AgentMessageRoute
      :from="tc.parentToolCallId ?? MAIN_AGENT_KEY"
      :to="target.kind === 'agents' ? target.agentIds : []"
      :scope="target.kind === 'scope' ? target.scope : undefined"
    />
    <MarkdownContent v-if="message" :content="message" :render="true" class="wa-args-message" />
    <p v-if="status === 'pending'" class="wa-pending">Waiting for delivery confirmation…</p>
  </div></RendererScrollRegion>
</template>

<style scoped>
.wa-args {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.wa-args-message {
  font-size: 0.8125rem;
  padding: 8px 12px;
  border-left: 2px solid var(--done-fg);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
}
.wa-pending { margin: 0; color: var(--text-secondary); font-size: 13px; }
</style>
