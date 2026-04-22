import { type ComputedRef, computed } from "vue";
import type { ModelEntry } from "@/composables/useTokenFlowData";
import { getChartColors, getSemanticColors } from "@/utils/designTokens";

export interface SankeyNode {
  id: string;
  col: number;
  label: string;
  tokens: number;
  color: string;
  x: number;
  y: number;
  h: number;
}

export interface SankeyLink {
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

export interface SankeyLayoutConstants {
  SVG_W: number;
  SVG_H: number;
  PAD_TOP: number;
  PAD_BOT: number;
  NODE_W: number;
  COL_X: readonly number[];
  NODE_GAP: number;
}

export const SANKEY_LAYOUT: SankeyLayoutConstants = {
  SVG_W: 960,
  SVG_H: 520,
  PAD_TOP: 44,
  PAD_BOT: 20,
  NODE_W: 18,
  COL_X: [80, 440, 820],
  NODE_GAP: 14,
};

const chartColors = getChartColors();
const semanticColors = getSemanticColors();

export const SANKEY_COLORS: Record<string, string> = {
  emerald: chartColors.success,
  amber: chartColors.warning,
  violet: chartColors.secondary,
  neutral: semanticColors.textTertiary,
  indigo: chartColors.primaryLight,
  rose: chartColors.danger,
};

export function sankeyModelColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("gpt") || n.includes("o1") || n.includes("o3") || n.includes("o4"))
    return SANKEY_COLORS.emerald;
  if (n.includes("haiku")) return SANKEY_COLORS.violet;
  if (n.includes("claude") || n.includes("sonnet") || n.includes("opus"))
    return SANKEY_COLORS.indigo;
  if (n.includes("gemini")) return SANKEY_COLORS.amber;
  return SANKEY_COLORS.indigo;
}

interface SankeyInputs {
  modelEntries: ComputedRef<ModelEntry[]>;
  hasTurns: ComputedRef<boolean>;
  totalInputTokens: ComputedRef<number>;
  totalOutputTokens: ComputedRef<number>;
  totalCacheWrite: ComputedRef<number>;
  estimatedUserInput: ComputedRef<number>;
  estimatedToolResults: ComputedRef<number>;
  estimatedSystemContext: ComputedRef<number>;
  estimatedAssistantText: ComputedRef<number>;
  estimatedReasoning: ComputedRef<number>;
  estimatedToolCalls: ComputedRef<number>;
}

export function useSankeyLayout(inputs: SankeyInputs) {
  const { PAD_TOP, PAD_BOT, SVG_H, NODE_W, NODE_GAP, COL_X } = SANKEY_LAYOUT;
  const usableHeight = SVG_H - PAD_TOP - PAD_BOT;

  return computed(() => {
    if (inputs.modelEntries.value.length === 0) return null;

    const rawNodes: Array<{
      id: string;
      col: number;
      label: string;
      tokens: number;
      color: string;
    }> = [];
    const rawLinks: Array<{ source: string; target: string; tokens: number; color: string }> = [];

    const detailed = inputs.hasTurns.value;

    if (detailed) {
      if (inputs.estimatedUserInput.value > 0)
        rawNodes.push({
          id: "in-user",
          col: 0,
          label: "User Input",
          tokens: inputs.estimatedUserInput.value,
          color: SANKEY_COLORS.emerald,
        });
      if (inputs.estimatedToolResults.value > 0)
        rawNodes.push({
          id: "in-tools",
          col: 0,
          label: "Tool Results",
          tokens: inputs.estimatedToolResults.value,
          color: SANKEY_COLORS.amber,
        });
      if (inputs.estimatedSystemContext.value > 0)
        rawNodes.push({
          id: "in-system",
          col: 0,
          label: "System / Context",
          tokens: inputs.estimatedSystemContext.value,
          color: SANKEY_COLORS.neutral,
        });

      if (inputs.estimatedAssistantText.value > 0)
        rawNodes.push({
          id: "out-assistant",
          col: 2,
          label: "Assistant Text",
          tokens: inputs.estimatedAssistantText.value,
          color: SANKEY_COLORS.indigo,
        });
      if (inputs.estimatedReasoning.value > 0)
        rawNodes.push({
          id: "out-reasoning",
          col: 2,
          label: "Reasoning",
          tokens: inputs.estimatedReasoning.value,
          color: SANKEY_COLORS.violet,
        });
      if (inputs.estimatedToolCalls.value > 0)
        rawNodes.push({
          id: "out-toolcalls",
          col: 2,
          label: "Tool Calls",
          tokens: inputs.estimatedToolCalls.value,
          color: SANKEY_COLORS.amber,
        });
      if (inputs.totalCacheWrite.value > 0)
        rawNodes.push({
          id: "out-cache",
          col: 2,
          label: "Cache Writes",
          tokens: inputs.totalCacheWrite.value,
          color: SANKEY_COLORS.neutral,
        });
    } else {
      rawNodes.push({
        id: "in-all",
        col: 0,
        label: "Input Tokens",
        tokens: inputs.totalInputTokens.value,
        color: SANKEY_COLORS.emerald,
      });
      rawNodes.push({
        id: "out-all",
        col: 2,
        label: "Output Tokens",
        tokens: inputs.totalOutputTokens.value,
        color: SANKEY_COLORS.indigo,
      });
    }

    for (const m of inputs.modelEntries.value) {
      rawNodes.push({
        id: `model-${m.name}`,
        col: 1,
        label: m.name,
        tokens: m.inputTokens + m.outputTokens,
        color: sankeyModelColor(m.name),
      });
    }

    const totalIn = inputs.totalInputTokens.value || 1;
    const totalOut = inputs.totalOutputTokens.value || 1;

    const inputSources = rawNodes.filter((n) => n.col === 0);
    const outputDests = rawNodes.filter((n) => n.col === 2);

    for (const m of inputs.modelEntries.value) {
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

    const columns = [0, 1, 2].map((col) =>
      rawNodes.filter((n) => n.col === col).sort((a, b) => a.id.localeCompare(b.id)),
    );

    const nodes: SankeyNode[] = [];
    const nodeMap = new Map<string, SankeyNode>();

    for (let col = 0; col < 3; col++) {
      const colNodes = columns[col];
      if (colNodes.length === 0) continue;
      const totalColTokens = colNodes.reduce((s, n) => s + n.tokens, 0) || 1;
      const totalGap = (colNodes.length - 1) * NODE_GAP;
      const availableH = usableHeight - totalGap;
      const minNodeH = 16;

      let assignedNodes: SankeyNode[] = colNodes.map((n) => {
        const h = Math.max(minNodeH, (n.tokens / totalColTokens) * availableH);
        return { ...n, x: COL_X[col], y: 0, h };
      });

      const totalNodeH = assignedNodes.reduce((s, n) => s + n.h, 0);
      const scale = availableH / totalNodeH;
      assignedNodes = assignedNodes.map((n) => ({ ...n, h: Math.max(minNodeH, n.h * scale) }));

      const finalTotalH = assignedNodes.reduce((s, n) => s + n.h, 0) + totalGap;
      let cy = PAD_TOP + (usableHeight - finalTotalH) / 2;
      for (const n of assignedNodes) {
        n.y = cy;
        cy += n.h + NODE_GAP;
        nodes.push(n);
        nodeMap.set(n.id, n);
      }
    }

    const sourceOffsets = new Map<string, number>();
    const targetOffsets = new Map<string, number>();
    for (const n of nodes) {
      sourceOffsets.set(n.id, 0);
      targetOffsets.set(n.id, 0);
    }

    const sortedLinks = [...rawLinks].sort((a, b) => {
      const sa = nodeMap.get(a.source);
      const sb = nodeMap.get(b.source);
      const ta = nodeMap.get(a.target);
      const tb = nodeMap.get(b.target);
      if (!sa || !sb || !ta || !tb) return 0;
      return sa.y - sb.y || ta.y - tb.y;
    });

    const links: SankeyLink[] = [];
    for (const l of sortedLinks) {
      const src = nodeMap.get(l.source);
      const tgt = nodeMap.get(l.target);
      if (!src || !tgt) continue;

      const srcTotal =
        rawLinks.filter((r) => r.source === l.source).reduce((s, r) => s + r.tokens, 0) || 1;
      const tgtTotal =
        rawLinks.filter((r) => r.target === l.target).reduce((s, r) => s + r.tokens, 0) || 1;
      const thickness = Math.max(
        2,
        Math.min((l.tokens / srcTotal) * src.h, (l.tokens / tgtTotal) * tgt.h),
      );

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
}
