<script setup lang="ts">
// Host wrapper: inline detail panel skin around the shared <SubagentPanel />.
// Reads the agent-tree context for selection, prefs, and tool-result loader.
import { SubagentPanel } from "@tracepilot/ui";
import { computed } from "vue";
import SubagentToolRow from "@/components/conversation/SubagentToolRow.vue";
import { fromAgentNode } from "@/composables/subagentView";
import { useAgentTreeContext } from "@/composables/useAgentTree";

const ctx = useAgentTreeContext();

const view = computed(() =>
  ctx.selectedNode.value ? fromAgentNode(ctx.selectedNode.value) : null,
);
const liveMs = computed(() =>
  ctx.selectedNode.value ? ctx.liveDuration(ctx.selectedNode.value) : undefined,
);

const renderMd = computed(() => ctx.prefs.isFeatureEnabled("renderMarkdown"));
const isRich = (toolName: string) => ctx.prefs.isRichRenderingEnabled(toolName);

function onSelectSubagent(toolCallId: string) {
  // Same-pane re-target: pick the agent-tree node whose toolCall matches the id.
  ctx.selectNode(toolCallId);
}
</script>

<template>
  <Transition name="detail-panel">
    <div v-if="view" class="detail-panel">
      <SubagentPanel
        :view="view"
        :live-duration-ms="liveMs"
        :render-markdown="renderMd"
        :is-rich-rendering-enabled="isRich"
        :full-results="ctx.fullResults"
        :loading-results="ctx.loadingResults"
        :failed-results="ctx.failedResults"
        @close="ctx.closeDetail()"
        @load-full-result="ctx.loadFullResult"
        @retry-full-result="ctx.retryFullResult"
        @select-subagent="onSelectSubagent"
      >
        <template #tool="{ item, expanded, fullResult, loadingFullResult, failedFullResult, richEnabled, toggle }">
          <SubagentToolRow
            :tool-call="item.toolCall"
            :expanded="expanded"
            :full-result="fullResult"
            :loading-full-result="loadingFullResult"
            :failed-full-result="failedFullResult"
            :rich-enabled="richEnabled"
            @toggle="toggle"
            @load-full-result="ctx.loadFullResult"
            @retry-full-result="ctx.retryFullResult"
          />
        </template>
      </SubagentPanel>
    </div>
  </Transition>
</template>
