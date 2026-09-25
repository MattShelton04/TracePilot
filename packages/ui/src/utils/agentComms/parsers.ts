// Parsers for the text results of Copilot CLI's agent-control tools
// (`read_agent`, `write_agent`, `list_agents`). The CLI formats these results
// for the model, not for machines, so every parser is tolerant: unknown shapes
// return `null` (or keep the raw text) and the renderer falls back to Markdown.
//
// Formats covered were observed across CLI 0.0.4xx–1.0.88 session logs.

// ─── Shared ──────────────────────────────────────────────────────

export type AgentRuntimeStatus =
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "pending"
  | "unknown";

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "idle",
  "completed",
  "failed",
  "cancelled",
  "pending",
]);

export function normalizeAgentStatus(raw: string | undefined): AgentRuntimeStatus {
  const status = raw?.trim().toLowerCase() ?? "";
  return KNOWN_STATUSES.has(status) ? (status as AgentRuntimeStatus) : "unknown";
}

/** Parse "72s" / "8s" / "3m" style durations into seconds. */
function parseSeconds(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(raw.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return value / 1000;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    default:
      return value;
  }
}

function parseInteger(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

// ─── read_agent ──────────────────────────────────────────────────

export interface ReadAgentTurn {
  index: number;
  /** Message that started this turn; absent for the launch turn. */
  message?: {
    /** Sender agent ID when another agent sent it; absent for the parent. */
    fromAgentId?: string;
    content: string;
  };
  /** The agent's reply. Empty when it answered through a tool instead. */
  response: string;
}

export interface ReadAgentResult {
  /** Sentence before the metadata, e.g. "Agent is idle (waiting for messages)". */
  headline: string;
  status: AgentRuntimeStatus;
  agentId?: string;
  agentType?: string;
  description?: string;
  elapsedSeconds?: number;
  durationSeconds?: number;
  totalTurns?: number;
  model?: string;
  currentIntent?: string;
  toolCallsCompleted?: number;
  /** The read returned before the agent finished. */
  timedOut: boolean;
  /** Turn transcript (1.0.5+ multi-turn format). */
  turns: ReadAgentTurn[];
  /** Output of older single-shot results with no `[Turn N]` markers. */
  body: string;
}

const READ_AGENT_KEYS = [
  "agent_id",
  "agent_type",
  "status",
  "description",
  "elapsed",
  "total_turns",
  "model",
  "current_intent",
  "tool_calls_completed",
  "duration",
] as const;

// Values can contain commas (descriptions, intents), so split only before a
// known key rather than on every comma.
const KEY_SPLIT = new RegExp(`,\\s+(?=(?:${READ_AGENT_KEYS.join("|")}):\\s)`);
const HEADER_START = /^(.*?)\.\s+(agent_id:\s[\s\S]*)$/;
const TRAILER =
  /,?\s*(\(timed out waiting for completion\))?\s*(You will be automatically notified[\s\S]*)?$/;

function parseReadAgentHeader(line: string): Omit<ReadAgentResult, "turns" | "body"> | null {
  const header = HEADER_START.exec(line);
  if (!header) return null;
  const [, headline, rest] = header;
  const timedOut = /\(timed out waiting for completion\)/.test(rest);
  const fields = new Map<string, string>();
  for (const part of rest.replace(TRAILER, "").split(KEY_SPLIT)) {
    const sep = part.indexOf(": ");
    if (sep > 0) fields.set(part.slice(0, sep).trim(), part.slice(sep + 2).trim());
  }
  if (!fields.has("agent_id")) return null;
  const intent = fields.get("current_intent");
  return {
    headline: headline.trim(),
    status: normalizeAgentStatus(fields.get("status")),
    agentId: fields.get("agent_id"),
    agentType: fields.get("agent_type"),
    description: fields.get("description"),
    elapsedSeconds: parseSeconds(fields.get("elapsed")),
    durationSeconds: parseSeconds(fields.get("duration")),
    totalTurns: parseInteger(fields.get("total_turns")),
    model: fields.get("model"),
    currentIntent: intent?.replace(/^"|"$/g, ""),
    toolCallsCompleted: parseInteger(fields.get("tool_calls_completed")),
    timedOut,
  };
}

const TURN_MARKER = /^\[Turn (\d+)\]\s*$/m;

function parseTurnBlock(index: number, block: string): ReadAgentTurn {
  const messageMatch =
    /^\[Message(?: from ([^\]]+))?\]\s*\n([\s\S]*?)(?:\n\[Response\]\s*\n?([\s\S]*))?$/.exec(block);
  if (!messageMatch) return { index, response: block.trim() };
  const [, fromAgentId, message, response = ""] = messageMatch;
  return {
    index,
    message: { fromAgentId: fromAgentId?.trim(), content: message.trim() },
    response: response.trim(),
  };
}

/** Parse a `read_agent` result. Returns `null` for unrecognized output. */
export function parseReadAgentResult(content: string | undefined): ReadAgentResult | null {
  if (!content) return null;
  const text = content.replace(/\r\n/g, "\n");
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const header = parseReadAgentHeader(firstLine);
  if (!header) return null;
  const rest = newline === -1 ? "" : text.slice(newline + 1);

  const turns: ReadAgentTurn[] = [];
  const parts = rest.split(TURN_MARKER);
  // split() with a capture group yields [preamble, n, block, n, block, …]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const index = Number(parts[i]);
    turns.push(parseTurnBlock(index, parts[i + 1].replace(/^\n+|\n+$/g, "")));
  }
  return { ...header, turns, body: turns.length ? parts[0].trim() : rest.trim() };
}

// ─── write_agent ─────────────────────────────────────────────────

export type WriteAgentTarget =
  | { kind: "agents"; agentIds: string[] }
  | { kind: "scope"; scope: string }
  | { kind: "unknown" };

/** Who a `write_agent` call addressed, from its arguments. */
export function writeAgentTarget(args: Record<string, unknown> | undefined): WriteAgentTarget {
  if (!args) return { kind: "unknown" };
  if (typeof args.agent_id === "string" && args.agent_id) {
    return { kind: "agents", agentIds: [args.agent_id] };
  }
  if (Array.isArray(args.agent_ids)) {
    const ids = args.agent_ids.filter((id): id is string => typeof id === "string" && !!id);
    if (ids.length) return { kind: "agents", agentIds: ids };
  }
  if (typeof args.scope === "string" && args.scope) return { kind: "scope", scope: args.scope };
  return { kind: "unknown" };
}

export interface WriteAgentDelivery {
  agentId: string;
  /** e.g. `delivered`, or a rejection reason. */
  outcome: string;
  delivered: boolean;
  /** Recipient state when the message arrived (multi-recipient results only). */
  taskStatus?: AgentRuntimeStatus;
}

export interface WriteAgentResult {
  /** First line of the result, e.g. "Message delivered to 2 agents." */
  summary: string;
  deliveries: WriteAgentDelivery[];
}

const SINGLE_DELIVERY = /^Message delivered to agent (\S+?)\.(?:\s|$)/;
const MULTI_LINE = /^-\s+([^,]+),\s*([^,]+?)(?:,\s*task_status=(\w+))?\s*$/;

/** Parse a `write_agent` result. Returns `null` for unrecognized output. */
export function parseWriteAgentResult(content: string | undefined): WriteAgentResult | null {
  if (!content) return null;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const summary = lines[0]?.trim() ?? "";
  const single = SINGLE_DELIVERY.exec(summary);
  if (single) {
    return { summary, deliveries: [{ agentId: single[1], outcome: "delivered", delivered: true }] };
  }
  const deliveries: WriteAgentDelivery[] = [];
  for (const line of lines.slice(1)) {
    const match = MULTI_LINE.exec(line.trim());
    if (!match) continue;
    const outcome = match[2].trim();
    deliveries.push({
      agentId: match[1].trim(),
      outcome,
      delivered: outcome === "delivered",
      taskStatus: match[3] ? normalizeAgentStatus(match[3]) : undefined,
    });
  }
  if (!deliveries.length && !/^Message delivered/i.test(summary)) return null;
  return { summary, deliveries };
}

// ─── list_agents ─────────────────────────────────────────────────

export interface ListedAgent {
  /** Display name (1.0.83+) or the legacy name-style agent ID. */
  name: string;
  agentId: string;
  agentType?: string;
  description?: string;
  elapsedSeconds?: number;
  /** Session or agent that owns the entry in the CLI's registry. */
  owner?: string;
  /** Relation to the caller: `child`, `sibling`, … (1.0.83+). */
  relation?: string;
  model?: string;
  /** MCP background task that supports reads only. */
  oneShot: boolean;
}

export interface ListedAgentGroup {
  status: AgentRuntimeStatus;
  label: string;
  agents: ListedAgent[];
}

export interface ListAgentsResult {
  scope?: string;
  groups: ListedAgentGroup[];
  total: number;
}

const GROUP_HEADER = /^(\w[\w ]*?) \((\d+)\):\s*$/;
const LIST_HEADER = /^Background agents(?: \(scope: ([^)]+)\))?:\s*$/;
// "🔄 alpha (uuid): general-purpose - "desc" (4s, owner: X, relation: sibling) (model: M)"
const AGENT_LINE =
  /^\s*(?:\S+\s+)?(.+?)(?: \(([^()\s]+)\))?: (\S+) - "(.*)" \(([^,)]+)(?:, owner: ([^,)]+))?(?:, relation: ([^,)]+))?\)(.*)$/u;

function parseAgentLine(line: string): ListedAgent | null {
  const match = AGENT_LINE.exec(line);
  if (!match) return null;
  const [, name, id, agentType, description, elapsed, owner, relation, tail] = match;
  const model = /\(model: ([^)]+)\)/.exec(tail)?.[1];
  return {
    name: name.trim(),
    agentId: (id ?? name).trim(),
    agentType,
    description,
    elapsedSeconds: parseSeconds(elapsed),
    owner: owner?.trim(),
    relation: relation?.trim(),
    model,
    oneShot: /one-shot/i.test(tail),
  };
}

/** Parse a `list_agents` result. Returns `null` for unrecognized output. */
export function parseListAgentsResult(content: string | undefined): ListAgentsResult | null {
  if (!content) return null;
  if (content.trim() === "<no background agents>") return { groups: [], total: 0 };
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const header = lines.findIndex((l) => LIST_HEADER.test(l.trim()));
  if (header === -1) return null;
  const scope = LIST_HEADER.exec(lines[header].trim())?.[1];
  const groups: ListedAgentGroup[] = [];
  for (const line of lines.slice(header + 1)) {
    const group = GROUP_HEADER.exec(line.trim());
    if (group) {
      groups.push({ status: normalizeAgentStatus(group[1]), label: group[1], agents: [] });
      continue;
    }
    const agent = line.trim() ? parseAgentLine(line) : null;
    if (agent && groups.length) groups[groups.length - 1].agents.push(agent);
  }
  const total = groups.reduce((sum, g) => sum + g.agents.length, 0);
  return { scope, groups, total };
}
