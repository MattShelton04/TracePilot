<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { ToolCallItem } from "@tracepilot/ui";
import SkillInvocationEventRow from "./SkillInvocationEventRow.vue";

defineProps<{
  toolCall: TurnToolCall;
  expanded: boolean;
  fullResult?: string;
  loadingFullResult: boolean;
  failedFullResult: boolean;
  richEnabled: boolean;
}>();

defineEmits<{
  toggle: [];
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
}>();
</script>

<template>
  <SkillInvocationEventRow
    v-if="toolCall.toolName === 'skill' && toolCall.skillInvocation"
    :tool-call="toolCall"
  />
  <ToolCallItem
    v-else
    :tc="toolCall"
    variant="compact"
    :expanded="expanded"
    :full-result="fullResult"
    :loading-full-result="loadingFullResult"
    :failed-full-result="failedFullResult"
    :rich-enabled="richEnabled"
    @toggle="$emit('toggle')"
    @load-full-result="$emit('load-full-result', $event)"
    @retry-full-result="$emit('retry-full-result', $event)"
  />
</template>
