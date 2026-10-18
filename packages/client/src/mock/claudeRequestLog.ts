import type {
  NormalizedSection,
  NormalizedToolDefinition,
  RecordedCall,
  RequestLog,
} from "@tracepilot/types";

const MINUTE_MS = 60_000;
const mockIso = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * MINUTE_MS).toISOString();

const size = (value: unknown) => {
  const text = JSON.stringify(value);
  return { bytes: text.length, characters: text.length };
};

const block = (index: number, text: string): NormalizedSection => ({
  index,
  source: "system",
  content: text,
  containsProbe: false,
  ...size({ type: "text", text }),
});

const tool = (index: number, name: string, description: string): NormalizedToolDefinition => {
  const schema = {
    type: "object",
    properties: { path: { type: "string", description: "A path in the workspace." } },
    required: ["path"],
  };
  const raw = { name, description, input_schema: schema };
  return { index, name, description, schema, raw, ...size(raw) };
};

const mainSystem = [
  block(0, "You are a coding agent in a mock workspace."),
  block(1, "Environment: mock platform, mock shell."),
];
const mainTools = [
  tool(0, "Read", "Read a file."),
  tool(1, "Edit", "Edit a file."),
  tool(2, "Agent", "Launch a subagent."),
];
const agentSystem = [block(0, "You are an Explore agent in a mock workspace.")];
const agentTools = [tool(0, "Read", "Read a file.")];

const call = (
  minute: number,
  shapeHash: string,
  agentId: string | null,
  extendsPrevious: boolean,
): RecordedCall => ({
  timestamp: mockIso(minute),
  model: "claude-opus-5-5",
  querySource: agentId ? "agent:builtin:Explore" : "repl_main_thread",
  agentId,
  agentType: agentId ? "Explore" : null,
  shapeHash,
  maxTokens: 64000,
  thinking: "adaptive",
  effort: "high",
  betas: ["mock-beta-2026-01-01"],
  contextEdits: ["clear_thinking"],
  cacheBreakpoints: 3,
  extendsPrevious,
});

const sum = (items: { bytes: number }[]) => items.reduce((total, item) => total + item.bytes, 0);

/** A Claude Code 2.1.301+ session's recorded requests: a main agent and one subagent. */
export const MOCK_CLAUDE_REQUEST_LOG: RequestLog = {
  shapes: [
    {
      hash: "mock-shape-main",
      firstUsed: mockIso(-30),
      calls: 4,
      agents: [{ agentId: null, agentType: null, calls: 4 }],
      system: mainSystem,
      tools: mainTools,
      systemBytes: sum(mainSystem),
      toolBytes: sum(mainTools),
    },
    {
      hash: "mock-shape-explore",
      firstUsed: mockIso(-27),
      calls: 2,
      agents: [{ agentId: "mock-agent-1", agentType: "Explore", calls: 2 }],
      system: agentSystem,
      tools: agentTools,
      systemBytes: sum(agentSystem),
      toolBytes: sum(agentTools),
    },
  ],
  omittedShapes: 0,
  calls: [
    call(-30, "mock-shape-main", null, false),
    call(-28, "mock-shape-main", null, true),
    call(-27, "mock-shape-explore", "mock-agent-1", false),
    call(-26, "mock-shape-explore", "mock-agent-1", true),
    call(-24, "mock-shape-main", null, true),
    call(-20, "mock-shape-main", null, true),
  ],
  totalCalls: 6,
  callsWithoutShape: 0,
  models: [{ name: "claude-opus-5-5", calls: 6 }],
  agents: [
    { agentId: null, agentType: null, calls: 4 },
    { agentId: "mock-agent-1", agentType: "Explore", calls: 2 },
  ],
  records: 14,
  unreadableRecords: 0,
  files: 2,
};

/** A session written before Claude Code recorded requests. */
export const MOCK_EMPTY_REQUEST_LOG: RequestLog = {
  shapes: [],
  omittedShapes: 0,
  calls: [],
  totalCalls: 0,
  callsWithoutShape: 0,
  models: [],
  agents: [],
  records: 0,
  unreadableRecords: 0,
  files: 1,
};
