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

/**
 * Renderer header hints truncate from the left (`direction: rtl`) to keep the
 * end of file paths visible. Left-to-right marks keep prose such as
 * "2 agents" in reading order under that direction.
 */
export function proseHint(text: string | undefined): string | undefined {
  return text ? `\u200E${text}\u200E` : undefined;
}

/** Agent ages from the CLI are whole seconds: "0s", "42s", "3m 05s", "1h 02m". */
export function formatAgentAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
