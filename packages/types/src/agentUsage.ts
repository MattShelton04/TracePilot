import type { ModelMetricDetail } from "./session.js";

/** Latest observed per-agent ledger. Each entry excludes descendant usage. */
export interface AgentUsageSnapshot {
  timestamp?: string | null;
  eventIndex: number;
  agents: Record<string, AgentUsageEntry>;
  hasInvalidFields: boolean;
}

export interface AgentUsageEntry {
  agentName?: string | null;
  agentDisplayName?: string | null;
  totalApiDurationMs?: number | null;
  totalNanoAiu?: number | null;
  modelMetrics: Record<string, ModelMetricDetail>;
}
