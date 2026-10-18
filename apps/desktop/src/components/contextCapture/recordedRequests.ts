import type { RecordedShape } from "@tracepilot/types";

/** "Main agent" for the main agent, else the subagent's type. */
export function recordedAgentLabel(agent: {
  agentId: string | null;
  agentType: string | null;
}): string {
  if (agent.agentId == null) return "Main agent";
  return agent.agentType || "Subagent";
}

/**
 * A prompt and tool set named by who used it: "Main agent", "Explore", or
 * "Explore + 2 more" when several agent kinds shared it.
 */
export function recordedShapeLabel(shape: RecordedShape): string {
  const names = [...new Set(shape.agents.map(recordedAgentLabel))];
  if (names.length === 0) return "Unused set";
  return names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`;
}

/** Shape labels made unique with a number when two sets share a name. */
export function recordedShapeLabels(shapes: RecordedShape[]): Map<string, string> {
  const labels = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const shape of shapes) {
    const label = recordedShapeLabel(shape);
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    labels.set(shape.hash, count === 1 ? label : `${label} (${count})`);
  }
  return labels;
}
