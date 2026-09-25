<script setup lang="ts">
import { EmptyState, provideAgentOpener } from "@tracepilot/ui";
import { Bot } from "lucide-vue-next";
import AgentTreeCanvas from "@/components/agentTree/AgentTreeCanvas.vue";
import AgentTreeDetailPanel from "@/components/agentTree/AgentTreeDetailPanel.vue";
import AgentTreeToolbar from "@/components/agentTree/AgentTreeToolbar.vue";
import { provideAgentTree, useAgentTree } from "@/composables/useAgentTree";
import "@/styles/features/agent-tree.css";

const ctx = useAgentTree();
provideAgentTree(ctx);

const { rootRef, agentTurns, selectedNodeId, selectNode } = ctx;

// Agent chips in tool renderers select that agent in the tree.
provideAgentOpener((key) => {
  if (selectedNodeId.value !== key) selectNode(key);
});
</script>

<template>
  <div ref="rootRef" class="agent-tree-feature agent-tree-view" tabindex="0">
    <EmptyState
      v-if="agentTurns.length === 0"
      title="No Agent Orchestration"
      description="No turns with subagent activity found in this session."
    >
      <template #icon><Bot :size="36" aria-hidden="true" /></template>
    </EmptyState>

    <template v-else>
      <AgentTreeToolbar />
      <AgentTreeCanvas />
      <AgentTreeDetailPanel />
    </template>
  </div>
</template>
