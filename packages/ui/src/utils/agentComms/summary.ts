// One-line summaries for agent-control tool rows, naming agents rather than
// printing their runtime IDs when a directory is available.

import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import type { AgentDirectory } from "./directory";
import { writeAgentTarget } from "./parsers";

const PREVIEW_LENGTH = 100;

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH)}…` : line;
}

function shortId(id: string): string {
  return /^[0-9a-f]{8}-/.test(id) ? id.slice(0, 8) : id;
}

/** Summary for `write_agent`, `read_agent` or `list_agents`; `null` for other tools. */
export function agentToolSummary(
  tc: TurnToolCall,
  directory: AgentDirectory | null,
): string | null {
  const args = getToolArgs(tc);
  const name = (id: string) => directory?.resolve(id)?.name ?? shortId(id);

  if (tc.toolName === "write_agent") {
    const target = writeAgentTarget(args);
    const to =
      target.kind === "agents"
        ? target.agentIds.map(name).join(", ")
        : target.kind === "scope"
          ? `all ${target.scope}`
          : "";
    const message = preview(toolArgString(args, "message"));
    return [to && `→ ${to}`, message].filter(Boolean).join(" · ");
  }
  if (tc.toolName === "read_agent") {
    const id = toolArgString(args, "agent_id") || toolArgString(args, "agent_name");
    if (!id) return null;
    const since = args.since_turn;
    return typeof since === "number" ? `${name(id)} · since turn ${since}` : name(id);
  }
  if (tc.toolName === "list_agents") {
    const scope = toolArgString(args, "scope");
    return scope ? `scope: ${scope}` : null;
  }
  return null;
}
