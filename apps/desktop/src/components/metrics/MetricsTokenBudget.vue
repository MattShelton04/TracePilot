<script setup lang="ts">
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatNumber, SectionPanel, StatCard } from "@tracepilot/ui";

defineProps<{
  metrics: ShutdownMetrics;
  hasTokenBudget: boolean;
}>();
</script>

<template>
  <SectionPanel v-if="hasTokenBudget" title="Token Budget" class="mb-6">
    <div class="grid-4">
      <StatCard
        :value="metrics.currentTokens != null ? formatNumber(metrics.currentTokens) : 'N/A'"
        label="Current Context"
        color="accent"
        tooltip="Total tokens currently in the context window at shutdown."
      />
      <StatCard
        :value="metrics.systemTokens != null ? formatNumber(metrics.systemTokens) : 'N/A'"
        label="System Prompt"
        color="done"
        tooltip="Tokens consumed by the system prompt."
      />
      <StatCard
        :value="metrics.conversationTokens != null ? formatNumber(metrics.conversationTokens) : 'N/A'"
        label="Conversation"
        tooltip="Tokens consumed by conversation history."
      />
      <StatCard
        :value="metrics.toolDefinitionsTokens != null ? formatNumber(metrics.toolDefinitionsTokens) : 'N/A'"
        label="Tool Definitions"
        tooltip="Tokens consumed by tool/function definitions."
      />
    </div>
  </SectionPanel>
</template>
