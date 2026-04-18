<script setup lang="ts">
import { EmptyState } from "@tracepilot/ui";
import AgentTreeToolbar from "@/components/agentTree/AgentTreeToolbar.vue";
import AgentTreeCanvas from "@/components/agentTree/AgentTreeCanvas.vue";
import AgentTreeDetailPanel from "@/components/agentTree/AgentTreeDetailPanel.vue";
import { provideAgentTree, useAgentTree } from "@/composables/useAgentTree";
import "@/styles/features/agent-tree.css";

const ctx = useAgentTree();
provideAgentTree(ctx);

const { rootRef, agentTurns } = ctx;
</script>

<template>
  <div ref="rootRef" class="agent-tree-feature agent-tree-view" tabindex="0">
    <EmptyState
      v-if="agentTurns.length === 0"
      icon="🤖"
      title="No Agent Orchestration"
      message="No turns with subagent activity found in this session."
    />

    <template v-else>
      <AgentTreeToolbar />
      <AgentTreeCanvas />
      <AgentTreeDetailPanel />
    </template>
  </div>
</template>
