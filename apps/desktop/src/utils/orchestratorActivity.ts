import type { SessionEvent } from "@tracepilot/types";
import { logWarn } from "@/utils/logger";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  icon: string;
  label: string;
  detail: string;
  eventType: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const data = isRecord(event.data) ? event.data : {};

  let icon = "📋";
  let label = event.eventType;
  let detail = "";

  switch (event.eventType) {
    case "tool.execution_start": {
      const tool = readString(data.toolName) || "unknown";
      const args = isRecord(data.arguments) ? data.arguments : {};

      if (tool === "task") {
        icon = "🚀";
        label = "Dispatched subagent";
        detail = readString(args.name) || "task";
      } else if (tool === "powershell" || tool === "bash") {
        icon = "💻";
        label = `Running ${tool}`;
        detail = truncate(readString(args.command), 80);
      } else if (tool === "view" || tool === "read") {
        icon = "📖";
        label = "Reading file";
        detail = fileNameFromPath(readString(args.path));
      } else if (tool === "create" || tool === "edit") {
        icon = "✏️";
        label = `Writing file (${tool})`;
        detail = fileNameFromPath(readString(args.path));
      } else if (tool === "read_agent") {
        icon = "👁️";
        label = "Checking subagent";
        detail = readString(args.agent_id);
      } else {
        icon = "🔧";
        label = `Tool: ${tool}`;
      }
      break;
    }
    case "subagent.started":
      icon = "▶️";
      label = "Subagent started";
      detail = readString(data.agentName);
      break;
    case "subagent.completed":
      icon = "✅";
      label = "Subagent completed";
      detail = readString(data.agentName);
      break;
    case "subagent.failed":
      icon = "❌";
      label = "Subagent failed";
      detail = readString(data.error) || readString(data.agentName);
      break;
    case "assistant.message":
      icon = "🤖";
      label = "Orchestrator thinking";
      detail = truncate(readString(data.content), 100);
      break;
    default:
      return null;
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
