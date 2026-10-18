import type { NormalizedToolDefinition, RecordedCall, RecordedShape } from "@tracepilot/types";

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

/**
 * The set's tools with each raw definition rebuilt: the log sends a tool's
 * name, description and schema once, and only its other fields as `raw`.
 */
export function recordedToolDefinitions(shape: RecordedShape): NormalizedToolDefinition[] {
  return shape.tools.map((tool) => {
    const extra =
      typeof tool.raw === "object" && tool.raw !== null && !Array.isArray(tool.raw)
        ? (tool.raw as Record<string, unknown>)
        : {};
    const raw: Record<string, unknown> = {};
    if (tool.name != null) raw.name = tool.name;
    if (tool.description != null) raw.description = tool.description;
    if (tool.schema != null) raw.input_schema = tool.schema;
    return { ...tool, raw: { ...raw, ...extra } };
  });
}

/**
 * The name of the set a call used: its label, "Set not shown" when the log
 * left the recorded set out, or "Unrecorded set" when no record of it was
 * found.
 */
export function recordedCallSetLabel(
  call: RecordedCall,
  labels: Map<string, string>,
  omitted: ReadonlySet<string>,
): string | null {
  if (!call.shapeHash) return null;
  const label = labels.get(call.shapeHash);
  if (label) return label;
  return omitted.has(call.shapeHash) ? "Set not shown" : "Unrecorded set";
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
