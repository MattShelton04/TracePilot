<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import {
  StatCard, SectionPanel, EmptyState, ErrorAlert,
  formatNumber, formatCost, useSessionTabLoader,
} from "@tracepilot/ui";
import type { ConversationTurn, ModelMetricDetail } from "@tracepilot/types";

const store = useSessionDetailStore();
const prefs = usePreferencesStore();

useSessionTabLoader(
  () => store.sessionId,
  async () => {
    await Promise.all([store.loadShutdownMetrics(), store.loadTurns()]);
  },
);

function retryLoadTokenFlow() {
  if (store.metricsError) {
    store.loaded.delete("metrics");
    store.loadShutdownMetrics();
  }
  if (store.turnsError) {
    store.loaded.delete("turns");
    store.loadTurns();
  }
}

const tokenFlowError = computed(() => {
  const errors = [store.metricsError, store.turnsError].filter(Boolean);
  return errors.length ? errors.join('; ') : null;
});
const metrics = computed(() => store.shutdownMetrics);
const turns = computed(() => store.turns);
const hasTurns = computed(() => turns.value.length > 0);

// ── Per-model entries ──
const modelEntries = computed(() => {
  if (!metrics.value?.modelMetrics) return [];
  return Object.entries(metrics.value.modelMetrics).map(([name, data]) => ({
    name,
    inputTokens: data.usage?.inputTokens ?? 0,
    outputTokens: data.usage?.outputTokens ?? 0,
    cacheReadTokens: data.usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: data.usage?.cacheWriteTokens ?? 0,
    requests: data.requests?.count ?? 0,
    cost: data.requests?.cost ?? 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
});

// ── Aggregate stats ──
const totalInputTokens = computed(() => modelEntries.value.reduce((s, m) => s + m.inputTokens, 0));
const totalOutputTokens = computed(() => modelEntries.value.reduce((s, m) => s + m.outputTokens, 0));
const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);
const totalCacheRead = computed(() => modelEntries.value.reduce((s, m) => s + m.cacheReadTokens, 0));
const totalCacheWrite = computed(() => modelEntries.value.reduce((s, m) => s + m.cacheWriteTokens, 0));
const modelsUsed = computed(() => modelEntries.value.length);
const wholesaleCost = computed(() =>
  modelEntries.value.reduce((s, m) => {
    const cost = prefs.computeWholesaleCost(m.name, m.inputTokens, m.cacheReadTokens, m.outputTokens);
    return s + (cost ?? 0);
  }, 0),
);
const copilotCost = computed(() => {
  const premiumReqs = metrics.value?.totalPremiumRequests ?? 0;
  return premiumReqs * prefs.costPerPremiumRequest;
});
const cacheHitRate = computed(() => {
  const denom = totalInputTokens.value;
  return denom > 0 ? (totalCacheRead.value / denom) * 100 : 0;
});

// ── Chars → token estimate (÷4 heuristic) ──
function charsToTokens(chars: number): number {
  return Math.round(chars / 4);
}

// ── Estimate input sources from turns ──
const estimatedUserInput = computed(() =>
  turns.value.reduce((s, t) => s + charsToTokens((t.userMessage ?? "").length), 0),
);
const estimatedToolResults = computed(() =>
  turns.value.reduce(
    (s, t) => s + t.toolCalls.reduce((ts, tc) => ts + charsToTokens((tc.resultContent ?? "").length), 0),
    0,
  ),
);
const estimatedSystemContext = computed(() => {
  const remainder = totalInputTokens.value - estimatedUserInput.value - estimatedToolResults.value;
  return Math.max(0, remainder);
});

// ── Estimate output destinations from turns ──
const estimatedAssistantText = computed(() =>
  turns.value.reduce((s, t) => s + charsToTokens(t.assistantMessages.join("").length), 0),
);
const estimatedReasoning = computed(() =>
  turns.value.reduce((s, t) => s + charsToTokens((t.reasoningTexts ?? []).join("").length), 0),
);
const estimatedToolCalls = computed(() => {
  const remainder = totalOutputTokens.value - estimatedAssistantText.value - estimatedReasoning.value;
  return Math.max(0, remainder);
});

// ── Color palette ──
const COLORS: Record<string, string> = {
  emerald: "#34d399",
  amber: "#fbbf24",
  violet: "#a78bfa",
  neutral: "#71717a",
  indigo: "#818cf8",
  rose: "#fb7185",
};

function modelColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("gpt") || n.includes("o1") || n.includes("o3") || n.includes("o4")) return COLORS.emerald;
  if (n.includes("haiku")) return COLORS.violet;
  if (n.includes("claude") || n.includes("sonnet") || n.includes("opus")) return COLORS.indigo;
  if (n.includes("gemini")) return COLORS.amber;
  return COLORS.indigo;
}

// ── Layout constants ──
const SVG_W = 960;
const SVG_H = 520;
const PAD_TOP = 44;
const PAD_BOT = 20;
const NODE_W = 18;
const COL_X = [80, 440, 820];
const NODE_GAP = 14;
const usableHeight = SVG_H - PAD_TOP - PAD_BOT;

// ── Node/link types ──
interface SankeyNode {
  id: string;
  col: number;
  label: string;
  tokens: number;
  color: string;
  x: number;
  y: number;
  h: number;
}

interface SankeyLink {
  id: string;
  source: string;
  target: string;
  tokens: number;
  color: string;
  path: string;
  particlePath: string;
  sourceY: number;
  targetY: number;
  thickness: number;
}

// ── Build Sankey data ──
const sankeyData = computed(() => {
  if (modelEntries.value.length === 0) return null;

  // Build raw nodes per column
  const rawNodes: Array<{ id: string; col: number; label: string; tokens: number; color: string }> = [];
  const rawLinks: Array<{ source: string; target: string; tokens: number; color: string }> = [];

  const detailed = hasTurns.value;

  if (detailed) {
    // Column 0: Input sources
    if (estimatedUserInput.value > 0)
      rawNodes.push({ id: "in-user", col: 0, label: "User Input", tokens: estimatedUserInput.value, color: COLORS.emerald });
    if (estimatedToolResults.value > 0)
      rawNodes.push({ id: "in-tools", col: 0, label: "Tool Results", tokens: estimatedToolResults.value, color: COLORS.amber });
    if (estimatedSystemContext.value > 0)
      rawNodes.push({ id: "in-system", col: 0, label: "System / Context", tokens: estimatedSystemContext.value, color: COLORS.neutral });

    // Column 2: Output destinations
    if (estimatedAssistantText.value > 0)
      rawNodes.push({ id: "out-assistant", col: 2, label: "Assistant Text", tokens: estimatedAssistantText.value, color: COLORS.indigo });
    if (estimatedReasoning.value > 0)
      rawNodes.push({ id: "out-reasoning", col: 2, label: "Reasoning", tokens: estimatedReasoning.value, color: COLORS.violet });
    if (estimatedToolCalls.value > 0)
      rawNodes.push({ id: "out-toolcalls", col: 2, label: "Tool Calls", tokens: estimatedToolCalls.value, color: COLORS.amber });
    if (totalCacheWrite.value > 0)
      rawNodes.push({ id: "out-cache", col: 2, label: "Cache Writes", tokens: totalCacheWrite.value, color: COLORS.neutral });
  } else {
    // Simplified: single input/output per model
    rawNodes.push({ id: "in-all", col: 0, label: "Input Tokens", tokens: totalInputTokens.value, color: COLORS.emerald });
    rawNodes.push({ id: "out-all", col: 2, label: "Output Tokens", tokens: totalOutputTokens.value, color: COLORS.indigo });
  }

  // Column 1: Models
  for (const m of modelEntries.value) {
    rawNodes.push({ id: `model-${m.name}`, col: 1, label: m.name, tokens: m.inputTokens + m.outputTokens, color: modelColor(m.name) });
  }

  // Links: input sources → models (proportional to each model's input share)
  const totalIn = totalInputTokens.value || 1;
  const totalOut = totalOutputTokens.value || 1;

  const inputSources = rawNodes.filter(n => n.col === 0);
  const outputDests = rawNodes.filter(n => n.col === 2);

  for (const m of modelEntries.value) {
    const mId = `model-${m.name}`;
    const inShare = m.inputTokens / totalIn;
    const outShare = m.outputTokens / totalOut;

    for (const src of inputSources) {
      const linkTokens = Math.round(src.tokens * inShare);
      if (linkTokens > 0) {
        rawLinks.push({ source: src.id, target: mId, tokens: linkTokens, color: src.color });
      }
    }

    for (const dst of outputDests) {
      const linkTokens = Math.round(dst.tokens * outShare);
      if (linkTokens > 0) {
        rawLinks.push({ source: mId, target: dst.id, tokens: linkTokens, color: dst.color });
      }
    }
  }

  // ── Layout: compute node positions ──
  const columns = [0, 1, 2].map(col =>
    rawNodes.filter(n => n.col === col).sort((a, b) => a.id.localeCompare(b.id)),
  );

  // For each column, compute total tokens and scale node heights
  const nodes: SankeyNode[] = [];
  const nodeMap = new Map<string, SankeyNode>();

  for (let col = 0; col < 3; col++) {
    const colNodes = columns[col];
    if (colNodes.length === 0) continue;
    const totalColTokens = colNodes.reduce((s, n) => s + n.tokens, 0) || 1;
    const totalGap = (colNodes.length - 1) * NODE_GAP;
    const availableH = usableHeight - totalGap;
    const minNodeH = 16;

    let assignedNodes: SankeyNode[] = colNodes.map(n => {
      const h = Math.max(minNodeH, (n.tokens / totalColTokens) * availableH);
      return { ...n, x: COL_X[col], y: 0, h };
    });

    // Rescale so total fits
    const totalNodeH = assignedNodes.reduce((s, n) => s + n.h, 0);
    const scale = availableH / totalNodeH;
    assignedNodes = assignedNodes.map(n => ({ ...n, h: Math.max(minNodeH, n.h * scale) }));

    // Stack vertically centered
    const finalTotalH = assignedNodes.reduce((s, n) => s + n.h, 0) + totalGap;
    let cy = PAD_TOP + (usableHeight - finalTotalH) / 2;
    for (const n of assignedNodes) {
      n.y = cy;
      cy += n.h + NODE_GAP;
      nodes.push(n);
      nodeMap.set(n.id, n);
    }
  }

  // ── Compute ribbon paths using cumulative offsets ──
  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();
  for (const n of nodes) {
    sourceOffsets.set(n.id, 0);
    targetOffsets.set(n.id, 0);
  }

  // Sort links for visual consistency
  const sortedLinks = [...rawLinks].sort((a, b) => {
    const sa = nodeMap.get(a.source);
    const sb = nodeMap.get(b.source);
    const ta = nodeMap.get(a.target);
    const tb = nodeMap.get(b.target);
    if (!sa || !sb || !ta || !tb) return 0;
    return (sa.y - sb.y) || (ta.y - tb.y);
  });

  const links: SankeyLink[] = [];
  for (const l of sortedLinks) {
    const src = nodeMap.get(l.source);
    const tgt = nodeMap.get(l.target);
    if (!src || !tgt) continue;

    // Compute thickness proportional to the source/target nodes
    const srcTotal = rawLinks.filter(r => r.source === l.source).reduce((s, r) => s + r.tokens, 0) || 1;
    const tgtTotal = rawLinks.filter(r => r.target === l.target).reduce((s, r) => s + r.tokens, 0) || 1;
    const thickness = Math.max(2, Math.min(
      (l.tokens / srcTotal) * src.h,
      (l.tokens / tgtTotal) * tgt.h,
    ));

    const srcOff = sourceOffsets.get(l.source) ?? 0;
    const tgtOff = targetOffsets.get(l.target) ?? 0;

    const sy = src.y + srcOff + thickness / 2;
    const ty = tgt.y + tgtOff + thickness / 2;

    sourceOffsets.set(l.source, srcOff + thickness);
    targetOffsets.set(l.target, tgtOff + thickness);

    const sx = src.x + NODE_W;
    const tx = tgt.x;
    const mx = (sx + tx) / 2;

    const path = `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
    const particlePath = path;

    links.push({
      id: `${l.source}->${l.target}`,
      source: l.source,
      target: l.target,
      tokens: l.tokens,
      color: l.color,
      path,
      particlePath,
      sourceY: sy,
      targetY: ty,
      thickness,
    });
  }

  return { nodes, links };
});

// ── Hover state ──
const hoveredLink = ref<string | null>(null);
const hoveredNode = ref<string | null>(null);

function connectedLinkIds(nodeId: string): Set<string> {
  if (!sankeyData.value) return new Set();
  return new Set(
    sankeyData.value.links
      .filter(l => l.source === nodeId || l.target === nodeId)
      .map(l => l.id),
  );
}

function connectedNodeIds(nodeId: string): Set<string> {
  if (!sankeyData.value) return new Set();
  const ids = new Set<string>([nodeId]);
  for (const l of sankeyData.value.links) {
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
    const link = sankeyData.value?.links.find(l => l.id === hoveredLink.value);
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

// ── Tooltip ──
const tooltipVisible = ref(false);
const tooltipX = ref(0);
const tooltipY = ref(0);
const tooltipText = ref("");

function showLinkTooltip(link: SankeyLink, event: MouseEvent) {
  hoveredLink.value = link.id;
  const src = sankeyData.value?.nodes.find(n => n.id === link.source);
  const tgt = sankeyData.value?.nodes.find(n => n.id === link.target);
  const total = totalTokens.value || 1;
  const pct = ((link.tokens / total) * 100).toFixed(1);
  tooltipText.value = `${src?.label ?? link.source} → ${tgt?.label ?? link.target}\n${formatNumber(link.tokens)} tokens (${pct}%)`;
  positionTooltip(event);
  tooltipVisible.value = true;
}

function showNodeTooltip(node: SankeyNode, event: MouseEvent) {
  hoveredNode.value = node.id;
  const total = totalTokens.value || 1;
  const pct = ((node.tokens / total) * 100).toFixed(1);
  tooltipText.value = `${node.label}\n${formatNumber(node.tokens)} tokens (${pct}%)`;
  positionTooltip(event);
  tooltipVisible.value = true;
}

function positionTooltip(event: MouseEvent) {
  // Tooltip uses position:fixed, so use viewport coordinates directly
  tooltipX.value = event.clientX + 12;
  tooltipY.value = event.clientY - 10;
}

function moveTooltip(event: MouseEvent) {
  positionTooltip(event);
}

function hideTooltip() {
  tooltipVisible.value = false;
  clearHover();
}

// ── Legend items ──
const legendItems = computed(() => {
  if (!hasTurns.value) {
    return [
      { label: "Input Tokens", color: COLORS.emerald },
      { label: "Output Tokens", color: COLORS.indigo },
    ];
  }
  return [
    { label: "User Input", color: COLORS.emerald },
    { label: "Tool Results / Calls", color: COLORS.amber },
    { label: "System / Context", color: COLORS.neutral },
    { label: "Assistant Text / Models", color: COLORS.indigo },
    { label: "Reasoning", color: COLORS.violet },
  ];
});

// Column headers
const colHeaders = ["INPUT SOURCES", "MODELS", "OUTPUT DESTINATIONS"];
</script>

<template>
  <div>
    <ErrorAlert
      v-if="tokenFlowError"
      :message="tokenFlowError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadTokenFlow"
    />

    <EmptyState v-if="!metrics && !tokenFlowError" message="No token data available for this session." />

    <template v-else-if="sankeyData">
      <!-- Stat cards -->
      <div class="grid-4 mb-6">
        <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
        <StatCard :value="formatNumber(totalInputTokens)" label="Input Tokens" color="accent" />
        <StatCard :value="formatNumber(totalOutputTokens)" label="Output Tokens" color="done" />
        <StatCard :value="`${cacheHitRate.toFixed(1)}%`" label="Cache Hit Rate" color="success" />
      </div>
      <div class="grid-4 mb-6">
        <StatCard :value="modelsUsed" label="Models Used" color="accent" />
        <StatCard :value="formatCost(wholesaleCost)" label="Wholesale Cost" color="warning" />
        <StatCard :value="formatCost(copilotCost)" label="Copilot Cost" color="accent" />
      </div>

      <!-- Sankey diagram -->
      <SectionPanel title="Token Flow" class="mb-6">
        <div class="sankey-container">
          <svg
            :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
            class="sankey-svg"
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

            <!-- Column headers -->
            <text
              v-for="(header, ci) in colHeaders"
              :key="ci"
              :x="COL_X[ci] + (ci === 1 ? NODE_W / 2 : ci === 0 ? NODE_W : 0)"
              :y="PAD_TOP - 16"
              class="col-header"
              :text-anchor="ci === 0 ? 'start' : ci === 2 ? 'end' : 'middle'"
            >{{ header }}</text>

            <!-- Ribbons -->
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

            <!-- Animated particles -->
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

            <!-- Nodes -->
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
              <!-- Label -->
              <text
                :x="node.col === 0 ? node.x - 8 : node.col === 2 ? node.x + NODE_W + 8 : node.x + NODE_W / 2"
                :y="node.y + node.h / 2"
                :text-anchor="node.col === 0 ? 'end' : node.col === 2 ? 'start' : 'middle'"
                dominant-baseline="central"
                class="node-label"
                :opacity="nodeOpacity(node)"
              >{{ node.label }}</text>
              <!-- Token count under label for model nodes -->
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

          <!-- Tooltip -->
          <div
            v-if="tooltipVisible"
            class="sankey-tooltip"
            :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
          >
            <span v-for="(line, i) in tooltipText.split('\n')" :key="i" class="tooltip-line">
              {{ line }}
            </span>
          </div>
        </div>

        <!-- Simplified mode notice -->
        <div v-if="!hasTurns" class="info-notice" style="margin-top: 12px;">
          ℹ Load conversation data for detailed token attribution
        </div>
      </SectionPanel>

      <!-- Legend -->
      <div class="legend-row">
        <div v-for="item in legendItems" :key="item.label" class="legend-item">
          <span class="legend-swatch" :style="{ background: item.color }" />
          <span class="legend-label">{{ item.label }}</span>
        </div>
      </div>

      <!-- Estimation note -->
      <div v-if="hasTurns" class="info-notice">
        ℹ Token attribution is estimated from message content lengths
      </div>
    </template>

    <EmptyState v-else message="No model usage data available for this session." />
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

.legend-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 0;
  margin-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.info-notice {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  padding: 4px 0;
}
</style>
