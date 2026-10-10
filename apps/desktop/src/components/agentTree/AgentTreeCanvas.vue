<script setup lang="ts">
import {
  AGENT_COLORS,
  formatLiveDuration,
  formatNumber,
  getAgentColor,
  getAgentIcon,
  STATUS_ICONS,
} from "@tracepilot/ui";
import { AlertTriangle, ArrowUpRight } from "lucide-vue-next";
import { type AgentNode, useAgentTreeContext } from "@/composables/useAgentTree";
import { useCountsUpToNow } from "@/composables/useCountsUpToNow";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { NO_FINAL_REPORT, settledAgentStatus } from "@/utils/agentEndState";
import type { AgentTreeSvgLine } from "@/utils/agentTreeLayout";

const ctx = useAgentTreeContext();
const modelName = useSessionModelName();
const store = useSessionDetailContext();
const mayStillReport = useCountsUpToNow(() => store.sessionId);

/** A subagent that never reported in an ended non-Copilot session is not running. */
function nodeStatus(node: AgentNode) {
  return node.type === "main" ? node.status : settledAgentStatus(node.status, mayStillReport.value);
}

function lineClass(line: AgentTreeSvgLine) {
  const node = ctx.layout.value?.nodes.find((n) => n.node.id === line.childId)?.node;
  return {
    "tree-connector--cross-turn": node?.isCrossTurnParent,
  };
}

function lineColor(line: AgentTreeSvgLine): string {
  if (!ctx.treeData.value) return AGENT_COLORS.main;

  const node = ctx.layout.value?.nodes.find((n) => n.node.id === line.childId)?.node;
  if (node?.isCrossTurnParent) return "var(--text-tertiary)";

  function findType(nodes: AgentNode[]): string | undefined {
    for (const n of nodes) {
      if (n.id === line.childId) return getAgentColor(n.type);
      if (n.children?.length) {
        const found = findType(n.children);
        if (found) return found;
      }
    }
    return undefined;
  }
  return findType(ctx.treeData.value.children) ?? AGENT_COLORS.main;
}

/**
 * Handles DOM element ref binding, filtering out component instances to only accept Elements.
 * @param nodeId - The node ID to associate with this element
 * @param el - The element or component public instance or null
 */
function handleNodeRef(nodeId: string, el: Element | null): void {
  ctx.setNodeRef(nodeId, el);
}
</script>

<template>
  <div v-if="ctx.layout.value" class="tree-container">
    <div
      class="tree-canvas"
      :style="{ width: `${ctx.layout.value.width}px`, height: `${ctx.canvasHeight.value}px` }"
    >
      <svg
        class="tree-svg"
        :width="ctx.layout.value.width"
        :height="ctx.canvasHeight.value"
        :viewBox="`0 0 ${ctx.layout.value.width} ${ctx.canvasHeight.value}`"
        role="img"
        aria-label="Agent tree visualization showing the hierarchical structure of agent and tool call execution"
      >
        <path
          v-for="(line, i) in ctx.displayLines.value"
          :key="`base-${i}`"
          :d="ctx.bezierPath(line)"
          class="tree-connector tree-connector--base"
          :class="lineClass(line)"
          :style="{ stroke: lineColor(line) }"
        />
        <path
          v-for="(line, i) in ctx.displayLines.value"
          :key="`flow-${i}`"
          :d="ctx.bezierPath(line)"
          class="tree-connector tree-connector--flow"
          :class="lineClass(line)"
          :style="{ stroke: lineColor(line) }"
        />
      </svg>

      <div
        v-for="ln in ctx.layout.value.nodes"
        :key="ln.node.id"
        :ref="(el) => handleNodeRef(ln.node.id, (el as Element | null))"
        class="agent-node"
        :class="{
          'agent-node--main': ln.node.type === 'main',
          'agent-node--selected': ctx.selectedNodeId.value === ln.node.id,
          'agent-node--in-progress': nodeStatus(ln.node) === 'in-progress',
          'agent-node--cross-turn': ln.node.isCrossTurnParent,
        }"
        :style="{
          left: `${ln.x}px`,
          top: `${ln.y}px`,
          width: `${ln.width}px`,
          '--node-color': getAgentColor(ln.node.type),
        }"
        role="button"
        tabindex="0"
        :aria-label="`${ln.node.displayName} — ${nodeStatus(ln.node) === 'unreported' ? NO_FINAL_REPORT : ln.node.status}`"
        @click="ctx.selectNode(ln.node.id)"
        @keydown.enter="ctx.selectNode(ln.node.id)"
        @keydown.space.prevent="ctx.selectNode(ln.node.id)"
      >
        <div v-if="ctx.nodeParallelLabel.value.get(ln.node.id)" class="parallel-badge">
          {{ ctx.nodeParallelLabel.value.get(ln.node.id) }}
        </div>

        <div
          v-if="ln.node.isCrossTurnParent && ln.node.sourceTurnIndex != null"
          class="cross-turn-badge"
          :title="`This subagent was launched in turn ${ln.node.sourceTurnIndex}`"
        >
          <ArrowUpRight :size="12" aria-hidden="true" /> Turn {{ ln.node.sourceTurnIndex }}
        </div>

        <div class="agent-node-header">
          <span class="agent-node-icon">{{ getAgentIcon(ln.node.type) }}</span>
          <span class="agent-node-name">{{ ln.node.displayName }}</span>
        </div>

        <div v-if="ln.node.model" class="agent-node-model" :title="ln.node.model">
          {{ modelName(ln.node.model) }}
          <span
            v-if="ln.node.status !== 'in-progress' && ln.node.requestedModel && ln.node.model !== ln.node.requestedModel"
            class="agent-node-model-warn"
            :title="`Requested ${ln.node.requestedModel} but a different model ran`"
            aria-label="model mismatch"
          ><AlertTriangle :size="12" /></span>
        </div>

        <div class="agent-node-meta">
          <span v-if="ctx.liveDuration(ln.node) != null">
            {{ formatLiveDuration(ctx.liveDuration(ln.node)) }}
          </span>
          <span>{{ ln.node.toolCount }} tool{{ ln.node.toolCount !== 1 ? "s" : "" }}</span>
          <span v-if="ln.node.totalTokens" class="agent-node-tokens">{{ formatNumber(ln.node.totalTokens) }} tok</span>
          <span
            v-if="nodeStatus(ln.node) === 'unreported'"
            class="agent-node-status agent-node-status--unreported"
            :title="NO_FINAL_REPORT"
          >
            {{ STATUS_ICONS.idle }}
            <span class="sr-only">{{ NO_FINAL_REPORT }}</span>
          </span>
          <span
            v-else
            class="agent-node-status"
            :class="{ 'agent-node-status--in-progress': ln.node.status === 'in-progress' }"
          >
            {{ STATUS_ICONS[ln.node.status] }}
            <span v-if="ln.node.status === 'in-progress'" class="sr-only">In progress</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
