import type { ConversationTurn, SessionSource } from "@tracepilot/types";
import {
  type ToolAggregateLabel,
  toolAggregateLabel,
  uniqueToolLabels,
} from "@/utils/toolDisplayName";

/** One compared session's identity and turns, as `useSessionComparison` holds them. */
export interface ToolComparisonSide {
  detail: { source?: SessionSource } | null;
  turns: ConversationTurn[];
}

export interface ToolCompRow {
  /** Canonical tool name: the row key, so Copilot's `powershell` and Claude Code's `PowerShell` share a row. */
  tool: string;
  /** Display name, by the app-wide rule: native names lead unless the row mixes sources. */
  label: string;
  /** The other naming (canonical or native), for the tooltip. */
  hint?: string;
  countA: number;
  countB: number;
  maxCount: number;
}

interface ToolTally {
  countA: number;
  countB: number;
  natives: Array<{ name: string; source?: SessionSource }>;
  hasCanonicalOnlyCalls: boolean;
}

/**
 * Tool rows for both sides, keyed by canonical name and labelled as the rest
 * of the app labels tools (`toolAggregateLabel`): Claude Code's `Bash`, not
 * `shell`, and the canonical name first when Copilot and Claude Code share a row.
 */
export function toolComparisonRows(a: ToolComparisonSide, b: ToolComparisonSide): ToolCompRow[] {
  const tallies = new Map<string, ToolTally>();
  const add = (data: ToolComparisonSide, side: "countA" | "countB") => {
    const source = data.detail?.source;
    for (const turn of data.turns) {
      for (const call of turn.toolCalls ?? []) {
        let tally = tallies.get(call.toolName);
        if (!tally) {
          tally = { countA: 0, countB: 0, natives: [], hasCanonicalOnlyCalls: false };
          tallies.set(call.toolName, tally);
        }
        tally[side]++;
        if (call.nativeToolName) {
          if (!tally.natives.some((n) => n.name === call.nativeToolName && n.source === source)) {
            tally.natives.push({ name: call.nativeToolName, source });
          }
        } else {
          tally.hasCanonicalOnlyCalls = true;
        }
      }
    }
  };
  add(a, "countA");
  add(b, "countB");
  const entries = [...tallies.entries()].sort(
    ([, x], [, y]) => y.countA + y.countB - (x.countA + x.countB),
  );
  const labels: ToolAggregateLabel[] = entries.map(([tool, tally]) =>
    toolAggregateLabel(tool, tally.natives, tally.hasCanonicalOnlyCalls),
  );
  const names = uniqueToolLabels(
    entries.map(([tool], i) => ({ canonical: tool, label: labels[i] })),
  );
  const maxCount = Math.max(...entries.map(([, t]) => Math.max(t.countA, t.countB)), 1);
  return entries.map(([tool, tally], i) => ({
    tool,
    label: names[i],
    hint: labels[i].hint,
    countA: tally.countA,
    countB: tally.countB,
    maxCount,
  }));
}
