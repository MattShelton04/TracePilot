import type { ContextSourceType } from "@tracepilot/types";

export interface SourceConfigField {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "select";
  default: unknown;
  hint: string;
  options?: string[];
}

export interface SourceTypeInfo {
  value: ContextSourceType;
  label: string;
  description: string;
  requiresSession: boolean;
  configSchema: SourceConfigField[];
}

export const SOURCE_TYPES: SourceTypeInfo[] = [
  {
    value: "session_export",
    label: "Session Export",
    description:
      "Full structured export of a session (conversation, plan, todos, metrics, etc.)",
    requiresSession: true,
    configSchema: [
      {
        key: "sections",
        label: "Sections",
        type: "string",
        default: "conversation,plan,todos,metrics,incidents,health",
        hint: "Comma-separated: conversation, events, todos, plan, checkpoints, metrics, incidents, health",
        options: [
          "conversation",
          "events",
          "todos",
          "plan",
          "checkpoints",
          "metrics",
          "incidents",
          "health",
        ],
      },
      {
        key: "max_bytes",
        label: "Max bytes",
        type: "number",
        default: 50000,
        hint: "Byte limit for the export output",
      },
    ],
  },
  {
    value: "session_analytics",
    label: "Session Analytics",
    description: "Aggregate stats from a session (events, turns, repo, model)",
    requiresSession: true,
    configSchema: [],
  },
  {
    value: "session_health",
    label: "Session Health",
    description: "Health scoring data for a session",
    requiresSession: true,
    configSchema: [],
  },
  {
    value: "session_todos",
    label: "Session Todos",
    description: "Plan / todos from a session's plan.md file",
    requiresSession: true,
    configSchema: [],
  },
  {
    value: "recent_sessions",
    label: "Recent Sessions",
    description: "Summary list of recent sessions",
    requiresSession: false,
    configSchema: [
      {
        key: "max_sessions",
        label: "Max sessions",
        type: "number",
        default: 10,
        hint: "How many recent sessions to include",
      },
    ],
  },
  {
    value: "multi_session_digest",
    label: "Multi-Session Digest",
    description:
      "Combined summary of sessions within a time window (daily/weekly)",
    requiresSession: false,
    configSchema: [
      {
        key: "window_hours",
        label: "Window (hours)",
        type: "number",
        default: 24,
        hint: "How many hours back to look (24 = daily, 168 = weekly)",
      },
      {
        key: "max_sessions",
        label: "Max sessions",
        type: "number",
        default: 50,
        hint: "Cap on sessions to include",
      },
      {
        key: "include_exports",
        label: "Include exports",
        type: "boolean",
        default: false,
        hint: "Include brief conversation exports per session (expensive)",
      },
    ],
  },
];

export function getSourceType(typeValue: string): SourceTypeInfo | undefined {
  return SOURCE_TYPES.find((s) => s.value === typeValue);
}

export function makeDefaultSourceConfig(
  info: SourceTypeInfo,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of info.configSchema) {
    config[field.key] = field.default;
  }
  return config;
}

export function mergeSourceConfig(
  info: SourceTypeInfo,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const newConfig: Record<string, unknown> = {};
  for (const field of info.configSchema) {
    newConfig[field.key] = existing[field.key] ?? field.default;
  }
  for (const [k, v] of Object.entries(existing)) {
    if (!(k in newConfig)) newConfig[k] = v;
  }
  return newConfig;
}
