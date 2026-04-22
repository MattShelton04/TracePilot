<script setup lang="ts">
import {
  AGENT_COLORS,
  formatLiveDuration,
  formatNumber,
  getAgentColor,
  STATUS_ICONS,
} from "@tracepilot/ui";
import { type AgentNode, useAgentTreeContext } from "@/composables/useAgentTree";
import type { AgentTreeSvgLine } from "@/utils/agentTreeLayout";

const ctx = useAgentTreeContext();

const AGENT_TYPE_ICONS: Record<string, string> = {
  explore: "🔍",
  "general-purpose": "🛠",
  "code-review": "🔎",
  task: "⚡",
  main: "🤖",
};

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
        :ref="(el: any) => ctx.setNodeRef(ln.node.id, el)"
        class="agent-node"
        :class="{
          'agent-node--main': ln.node.type === 'main',
          'agent-node--selected': ctx.selectedNodeId.value === ln.node.id,
          'agent-node--in-progress': ln.node.status === 'in-progress',
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
        :aria-label="`${ln.node.displayName} — ${ln.node.status}`"
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
          ↗ Turn {{ ln.node.sourceTurnIndex }}
        </div>

        <div class="agent-node-header">
          <span class="agent-node-icon">{{ AGENT_TYPE_ICONS[ln.node.type] ?? "🤖" }}</span>
          <span class="agent-node-name">{{ ln.node.displayName }}</span>
        </div>

        <div v-if="ln.node.model" class="agent-node-model">
          {{ ln.node.model }}
          <span
            v-if="ln.node.status !== 'in-progress' && ln.node.requestedModel && ln.node.model !== ln.node.requestedModel"
            class="agent-node-model-warn"
            :title="`Requested ${ln.node.requestedModel} but a different model ran`"
          >⚠</span>
        </div>

        <div class="agent-node-meta">
          <span v-if="ctx.liveDuration(ln.node) != null">
            {{ formatLiveDuration(ctx.liveDuration(ln.node)) }}
          </span>
          <span>{{ ln.node.toolCount }} tool{{ ln.node.toolCount !== 1 ? "s" : "" }}</span>
          <span v-if="ln.node.totalTokens" class="agent-node-tokens">{{ formatNumber(ln.node.totalTokens) }} tok</span>
          <span
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
