<script setup lang="ts">
/**
 * WriteAgentArgsRenderer — a `write_agent` message before its result arrives:
 * the route and the message text.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { toolArgString } from "@tracepilot/types";
import { computed } from "vue";
import { MAIN_AGENT_KEY, writeAgentTarget } from "../../utils/agentComms";
import AgentMessageRoute from "../agentComms/AgentMessageRoute.vue";
import MarkdownContent from "../MarkdownContent.vue";

const props = defineProps<{
  args: Record<string, unknown>;
  tc: TurnToolCall;
}>();

const target = computed(() => writeAgentTarget(props.args));
const message = computed(() => toolArgString(props.args, "message"));
</script>

<template>
  <div class="wa-args">
    <AgentMessageRoute
      :from="tc.parentToolCallId ?? MAIN_AGENT_KEY"
      :to="target.kind === 'agents' ? target.agentIds : []"
      :scope="target.kind === 'scope' ? target.scope : undefined"
    />
    <MarkdownContent v-if="message" :content="message" :render="true" class="wa-args-message" />
  </div>
</template>

<style scoped>
.wa-args {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
}
.wa-args-message {
  font-size: 0.8125rem;
}
</style>
