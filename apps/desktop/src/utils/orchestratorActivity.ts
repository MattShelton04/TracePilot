import type { SessionEvent } from "@tracepilot/types";
import { narrowSessionEvent } from "@tracepilot/types";
import { logWarn } from "@/utils/logger";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  icon: string;
  label: string;
  detail: string;
  eventType: string;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function mapEvent(event: SessionEvent, index: number): ActivityEntry | null {
  const timestamp = readString(event.timestamp);
  const payload = narrowSessionEvent(event);

  let icon = "📋";
  let label = event.eventType;
  let detail = "";

  switch (payload.kind) {
    case "tool.execution_start": {
      const { toolName, arguments: args } = payload;

      if (toolName === "task") {
        icon = "🚀";
        label = "Dispatched subagent";
        detail = readString(args.name) || "task";
      } else if (toolName === "powershell" || toolName === "bash") {
        icon = "💻";
        label = `Running ${toolName}`;
        detail = truncate(readString(args.command), 80);
      } else if (toolName === "view" || toolName === "read") {
        icon = "📖";
        label = "Reading file";
        detail = fileNameFromPath(readString(args.path));
      } else if (toolName === "create" || toolName === "edit") {
        icon = "✏️";
        label = `Writing file (${toolName})`;
        detail = fileNameFromPath(readString(args.path));
      } else if (toolName === "read_agent") {
        icon = "👁️";
        label = "Checking subagent";
        detail = readString(args.agent_id);
      } else {
        icon = "🔧";
        label = `Tool: ${toolName}`;
      }
      break;
    }
    case "subagent.started":
      icon = "▶️";
      label = "Subagent started";
      detail = payload.agentName;
      break;
    case "subagent.completed":
      icon = "✅";
      label = "Subagent completed";
      detail = payload.agentName;
      break;
    case "subagent.failed":
      icon = "❌";
      label = "Subagent failed";
      detail = payload.error || payload.agentName;
      break;
    case "assistant.message":
      icon = "🤖";
      label = "Orchestrator thinking";
      detail = truncate(payload.content, 100);
      break;
    case "unknown":
      return null;
    default: {
      const _exhaustive: never = payload;
      void _exhaustive;
      return null;
    }
  }

  return {
    id: readString(event.id) || `${timestamp}-${index}`,
    timestamp,
    icon,
    label,
    detail,
    eventType: event.eventType,
  };
}

export function toActivityEntries(events: SessionEvent[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const [index, event] of events.entries()) {
    try {
      const mapped = mapEvent(event, index);
      if (mapped) entries.push(mapped);
    } catch (error) {
      logWarn("[orchestrator] Failed to map activity event:", error, event);
    }
  }

  return entries;
}
