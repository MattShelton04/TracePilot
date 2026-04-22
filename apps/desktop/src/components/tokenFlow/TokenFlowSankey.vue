<script setup lang="ts">
import { formatNumber } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { SANKEY_LAYOUT, type SankeyLink, type SankeyNode } from "@/composables/useSankeyLayout";

const props = defineProps<{
  sankeyData: { nodes: SankeyNode[]; links: SankeyLink[] };
  totalTokens: number;
  hasTurns: boolean;
}>();

const { SVG_W, SVG_H, PAD_TOP, NODE_W, COL_X } = SANKEY_LAYOUT;
const colHeaders = ["INPUT SOURCES", "MODELS", "OUTPUT DESTINATIONS"];

const hoveredLink = ref<string | null>(null);
const hoveredNode = ref<string | null>(null);

function connectedLinkIds(nodeId: string): Set<string> {
  return new Set(
    props.sankeyData.links
      .filter((l) => l.source === nodeId || l.target === nodeId)
      .map((l) => l.id),
  );
}

function connectedNodeIds(nodeId: string): Set<string> {
  const ids = new Set<string>([nodeId]);
  for (const l of props.sankeyData.links) {
    if (l.source === nodeId) ids.add(l.target);
    if (l.target === nodeId) ids.add(l.source);
  }
  return ids;
}

function linkOpacity(link: SankeyLink): number {
  if (hoveredLink.value) {
    return link.id === hoveredLink.value ? 0.7 : 0.06;
  }
  if (hoveredNode.value) {
    return connectedLinkIds(hoveredNode.value).has(link.id) ? 0.7 : 0.06;
  }
  return 0.35;
}

function nodeOpacity(node: SankeyNode): number {
  if (hoveredNode.value) {
    return connectedNodeIds(hoveredNode.value).has(node.id) ? 1 : 0.3;
  }
  if (hoveredLink.value) {
    const link = props.sankeyData.links.find((l) => l.id === hoveredLink.value);
    if (link) {
      return node.id === link.source || node.id === link.target ? 1 : 0.3;
    }
  }
  return 1;
}

function clearHover() {
  hoveredLink.value = null;
  hoveredNode.value = null;
}

const tooltipVisible = ref(false);
const tooltipX = ref(0);
const tooltipY = ref(0);
const tooltipText = ref("");

function positionTooltip(event: MouseEvent) {
  tooltipX.value = event.clientX + 12;
  tooltipY.value = event.clientY - 10;
}

function showLinkTooltip(link: SankeyLink, event: MouseEvent) {
  hoveredLink.value = link.id;
  const src = props.sankeyData.nodes.find((n) => n.id === link.source);
  const tgt = props.sankeyData.nodes.find((n) => n.id === link.target);
  const total = props.totalTokens || 1;
  const pct = ((link.tokens / total) * 100).toFixed(1);
  tooltipText.value = `${src?.label ?? link.source} → ${tgt?.label ?? link.target}\n${formatNumber(link.tokens)} tokens (${pct}%)`;
  positionTooltip(event);
  tooltipVisible.value = true;
}

function showNodeTooltip(node: SankeyNode, event: MouseEvent) {
  hoveredNode.value = node.id;
  const total = props.totalTokens || 1;
  const pct = ((node.tokens / total) * 100).toFixed(1);
  tooltipText.value = `${node.label}\n${formatNumber(node.tokens)} tokens (${pct}%)`;
  positionTooltip(event);
  tooltipVisible.value = true;
}

function moveTooltip(event: MouseEvent) {
  positionTooltip(event);
}

function hideTooltip() {
  tooltipVisible.value = false;
  clearHover();
}

const tooltipLines = computed(() => tooltipText.value.split("\n"));
</script>

<template>
  <div class="sankey-container">
    <svg
      :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
      class="sankey-svg"
      role="img"
      aria-label="Sankey diagram showing token flow between input and output categories"
      @mouseleave="hideTooltip"
    >
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="ribbon-clip">
          <rect :x="COL_X[0] + NODE_W" :y="0" :width="COL_X[2] - COL_X[0] - NODE_W" :height="SVG_H" />
        </clipPath>
      </defs>

      <text
        v-for="(header, ci) in colHeaders"
        :key="ci"
        :x="COL_X[ci] + (ci === 1 ? NODE_W / 2 : ci === 0 ? NODE_W : 0)"
        :y="PAD_TOP - 16"
        class="col-header"
        :text-anchor="ci === 0 ? 'start' : ci === 2 ? 'end' : 'middle'"
      >{{ header }}</text>

      <g class="ribbons" clip-path="url(#ribbon-clip)">
        <path
          v-for="link in sankeyData.links"
          :key="link.id"
          :d="link.path"
          :stroke="link.color"
          :stroke-width="link.thickness"
          fill="none"
          stroke-linecap="butt"
          :opacity="linkOpacity(link)"
          :filter="linkOpacity(link) > 0.5 ? 'url(#glow)' : 'none'"
          class="ribbon"
          @mouseenter="showLinkTooltip(link, $event)"
          @mousemove="moveTooltip"
          @mouseleave="hideTooltip"
        />
      </g>

      <g class="particles" clip-path="url(#ribbon-clip)">
        <path
          v-for="link in sankeyData.links"
          :key="`p-${link.id}`"
          :d="link.particlePath"
          fill="none"
          :stroke="link.color"
          :stroke-width="Math.max(2, link.thickness * 0.3)"
          :opacity="linkOpacity(link) * 0.6"
          :stroke-dasharray="`${Math.max(4, link.thickness * 0.5)} ${Math.max(8, link.thickness * 1.5)}`"
          stroke-linecap="round"
          :style="{
            animationDuration: `${Math.max(1, 4 - link.thickness * 0.05)}s`,
            '--dash-total': `${Math.max(4, link.thickness * 0.5) + Math.max(8, link.thickness * 1.5)}`,
          }"
          class="particle-path"
        />
      </g>

      <g v-for="node in sankeyData.nodes" :key="node.id" class="node-group">
        <rect
          :x="node.x"
          :y="node.y"
          :width="NODE_W"
          :height="node.h"
          :fill="node.color"
          :rx="2"
          :ry="2"
          :opacity="nodeOpacity(node)"
          filter="url(#glow)"
          class="node-rect"
          @mouseenter="showNodeTooltip(node, $event)"
          @mousemove="moveTooltip"
          @mouseleave="hideTooltip"
        />
        <text
          :x="node.col === 0 ? node.x - 8 : node.col === 2 ? node.x + NODE_W + 8 : node.x + NODE_W / 2"
          :y="node.y + node.h / 2"
          :text-anchor="node.col === 0 ? 'end' : node.col === 2 ? 'start' : 'middle'"
          dominant-baseline="central"
          class="node-label"
          :opacity="nodeOpacity(node)"
        >{{ node.label }}</text>
        <text
          v-if="node.col === 1"
          :x="node.x + NODE_W / 2"
          :y="node.y + node.h / 2 + 14"
          text-anchor="middle"
          dominant-baseline="central"
          class="node-sublabel"
          :opacity="nodeOpacity(node) * 0.7"
        >{{ formatNumber(node.tokens) }}</text>
      </g>
    </svg>

    <div
      v-if="tooltipVisible"
      class="sankey-tooltip"
      :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
    >
      <span v-for="(line, i) in tooltipLines" :key="i" class="tooltip-line">
        {{ line }}
      </span>
    </div>
  </div>

  <div v-if="!hasTurns" class="info-notice" style="margin-top: 12px;">
    ℹ Load conversation data for detailed token attribution
  </div>
</template>

<style scoped>
.sankey-container {
  position: relative;
  width: 100%;
  overflow: visible;
}

.sankey-svg {
  width: 100%;
  height: auto;
  display: block;
}

.col-header {
  fill: var(--text-tertiary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ribbon {
  transition: opacity 0.2s ease;
  cursor: pointer;
}

.particle-path {
  animation: particle-flow 2s linear infinite;
  pointer-events: none;
}

@keyframes particle-flow {
  from {
    stroke-dashoffset: calc(var(--dash-total) * 1px);
  }
  to {
    stroke-dashoffset: 0;
  }
}

.node-rect {
  transition: opacity 0.2s ease;
  cursor: pointer;
}

.node-label {
  fill: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.node-sublabel {
  fill: var(--text-tertiary);
  font-size: 9px;
  font-weight: 400;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.sankey-tooltip {
  position: fixed;
  z-index: var(--z-tooltip);
  padding: 8px 12px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tooltip-line {
  font-size: 0.75rem;
  color: var(--text-primary);
  white-space: nowrap;
}

.tooltip-line:last-child {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.info-notice {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  padding: 4px 0;
}
</style>
