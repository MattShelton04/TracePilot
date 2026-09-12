import type {
  AgentUsageEntry,
  ConversationTurn,
  ModelMetricDetail,
  ShutdownMetrics,
  TurnToolCall,
} from "@tracepilot/types";
import { agentStatusFromToolCall } from "@tracepilot/ui";
import { combinedTokenBreakdown, type MetricsTokenBreakdown } from "./metricsTokenBreakdown";

export interface AgentUsageNumbers {
  credits: number | null;
  apiMs: number | null;
  requests: number | null;
  tokens: MetricsTokenBreakdown;
  tools: number;
  partial: boolean;
}

export interface AgentUsageRow {
  [key: string]: unknown;
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  status: string;
  models: Record<string, ModelMetricDetail>;
  modelNames: string;
  own: AgentUsageNumbers;
  branch: AgentUsageNumbers;
  toolCallId?: string;
  turnIndex?: number;
  eventIndex?: number;
}

/** Reconcile only snapshots from the same shutdown, using exclusive entries. */
export function agentUsageCoverage(metrics: ShutdownMetrics) {
  const snapshot = metrics.agentUsage;
  const values = Object.values(snapshot?.agents ?? {}).map((entry) => entry.totalNanoAiu);
  const known = values.filter((value): value is number => value != null);
  const attributed = known.length ? known.reduce((a, b) => a + b, 0) / 1e9 : null;
  const comparable = !!snapshot?.timestamp && snapshot.timestamp === metrics.metricsTimestamp;
  const sessionCredits =
    comparable && metrics.totalNanoAiu != null ? metrics.totalNanoAiu / 1e9 : null;
  const difference =
    sessionCredits != null && attributed != null ? sessionCredits - attributed : null;
  return {
    attributed,
    sessionCredits,
    comparable,
    complete: values.length > 0 && known.length === values.length && !snapshot?.hasInvalidFields,
    remainder: difference != null && difference > 1e-8 ? difference : null,
    exceedsTotal: difference != null && difference < -1e-8,
  };
}

function sum(values: Array<number | null | undefined>): number | null {
  return values.length > 0 && values.every((v) => v != null && Number.isFinite(v))
    ? values.reduce<number>((n, v) => n + (v ?? 0), 0)
    : null;
}

function ownNumbers(entry: AgentUsageEntry | undefined, tools: number): AgentUsageNumbers {
  const models = Object.values(entry?.modelMetrics ?? {});
  return {
    credits: entry?.totalNanoAiu != null ? entry.totalNanoAiu / 1_000_000_000 : null,
    apiMs: entry?.totalApiDurationMs ?? null,
    requests: sum(models.map((m) => m.requests?.count)),
    tokens: combinedTokenBreakdown(models),
    tools,
    partial: entry == null || entry.totalNanoAiu == null,
  };
}

/** Sum known values, retaining partial coverage instead of treating unknown as zero. */
function addKnown(a: number | null, b: number | null): number | null {
  return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
}

function addBranch(target: AgentUsageNumbers, child: AgentUsageNumbers) {
  target.partial ||= child.partial;
  target.credits = addKnown(target.credits, child.credits);
  target.apiMs = sum([target.apiMs, child.apiMs]);
  target.requests = sum([target.requests, child.requests]);
  target.tools += child.tools;
  for (const key of [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "uncached",
    "notCached",
    "reasoning",
    "total",
  ] as const) {
    target.tokens[key] = sum([target.tokens[key], child.tokens[key]]);
  }
  target.tokens.inconsistent ||= child.tokens.inconsistent;
  const { input, cacheRead } = target.tokens;
  target.tokens.cacheRatio =
    input != null && input > 0 && cacheRead != null && cacheRead <= input
      ? cacheRead / input
      : null;
}

/** Join the exclusive ledger to actual launch identities, never to display names. */
export function buildAgentUsageRows(
  metrics: ShutdownMetrics | null | undefined,
  turns: ConversationTurn[],
): AgentUsageRow[] {
  const ledger = metrics?.agentUsage?.agents ?? {};
  const calls = turns.flatMap((turn) =>
    turn.toolCalls.map((call) => ({ call, turn: turn.turnIndex })),
  );
  const launches = calls.filter(({ call }) => call.isSubagent && call.toolCallId);
  const launchOrder = new Map(launches.map(({ call }, index) => [call.toolCallId, index]));
  const identities = new Map<string, string>();
  const info = new Map<string, { call: TurnToolCall; turn: number }>();
  for (const launch of launches) {
    const callId = launch.call.toolCallId as string;
    const id =
      launch.call.agentId && ledger[launch.call.agentId]
        ? launch.call.agentId
        : ledger[callId]
          ? callId
          : (launch.call.agentId ?? callId);
    identities.set(callId, id);
    info.set(id, launch);
  }
  const toolCounts = new Map<string, number>();
  for (const { call } of calls) {
    const id = call.parentToolCallId
      ? (identities.get(call.parentToolCallId) ?? call.parentToolCallId)
      : "main";
    toolCounts.set(id, (toolCounts.get(id) ?? 0) + 1);
  }
  const map = new Map<string, AgentUsageRow>();
  const ids = new Set(["main", ...Object.keys(ledger), ...info.keys()]);
  for (const id of ids) {
    const launch = info.get(id);
    const entry = ledger[id];
    const tc = launch?.call;
    const parentId = tc
      ? tc.parentToolCallId
        ? (identities.get(tc.parentToolCallId) ?? tc.parentToolCallId)
        : "main"
      : null;
    const models = entry?.modelMetrics ?? {};
    const own = ownNumbers(entry, toolCounts.get(id) ?? 0);
    map.set(id, {
      id,
      name:
        id === "main"
          ? "Main agent"
          : (tc?.agentDisplayName ??
            entry?.agentDisplayName ??
            entry?.agentName ??
            tc?.toolName ??
            `Agent ${id.slice(0, 8)}`),
      parentId,
      depth: 0,
      status: tc ? agentStatusFromToolCall(tc) : id === "main" ? "main" : "unlinked",
      models,
      modelNames: Object.keys(models).sort().join(", ") || tc?.model || "—",
      own,
      branch: { ...own, tokens: { ...own.tokens } },
      toolCallId: tc?.toolCallId ?? undefined,
      turnIndex: launch?.turn,
      eventIndex: tc?.eventIndex ?? undefined,
    });
  }
  // Rust HashMap serialization has no stable key order. Use log launch order
  // for known agents and stable IDs for unmatched ledger entries.
  const allRows = [...map.values()].sort((a, b) => {
    if (a.id === b.id) return 0;
    if (a.id === "main") return -1;
    if (b.id === "main") return 1;
    const aOrder = launchOrder.get(a.toolCallId) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = launchOrder.get(b.toolCallId) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const children = new Map<string, AgentUsageRow[]>();
  for (const row of allRows) {
    if (row.parentId && row.parentId !== row.id && map.has(row.parentId)) {
      const group = children.get(row.parentId) ?? [];
      group.push(row);
      children.set(row.parentId, group);
    }
  }
  const ordered: AgentUsageRow[] = [];
  const visited = new Set<string>();
  const roots = allRows.filter((row) => !row.parentId || !map.has(row.parentId));
  // The second pass retains malformed cycles and orphan rows without recursion.
  for (const root of [...roots, ...allRows]) {
    const stack = [{ row: root, depth: 0 }];
    while (stack.length) {
      const { row, depth } = stack.pop() as { row: AgentUsageRow; depth: number };
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      row.depth = depth;
      ordered.push(row);
      for (const child of [...(children.get(row.id) ?? [])].reverse())
        stack.push({ row: child, depth: depth + 1 });
    }
  }
  for (const row of [...ordered].reverse()) {
    const parent = row.parentId ? map.get(row.parentId) : null;
    if (parent && parent.depth + 1 === row.depth) addBranch(parent.branch, row.branch);
  }
  return ordered;
}
