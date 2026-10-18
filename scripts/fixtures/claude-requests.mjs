/**
 * A Claude Code 2.1.301+ session with request records (record-shapes.md,
 * "Request records") for the Context tab's "Recorded requests" view. Mirrors
 * crates/tracepilot-test-support/src/claude/requests.rs. Every prompt, tool
 * and id is invented.
 */

import { MODEL, Transcript, text, toolUse } from "./claude-transcript.mjs";

export const claudeRequestLogSessionId = "c1a0de00-0000-4000-8000-00000000000c";
export const REQUEST_RECORDS_VERSION = "2.1.302";

const agentId = "a0c1a000c0000001";

/** The request record's time: the transcript clock, not advanced. */
function stamp(t) {
  return new Date(Date.parse(t.start) + t.clock * 1000).toISOString();
}

function requestRecord(t, type, body, timed = true) {
  t.bookkeeping({
    type,
    ...(timed ? { timestamp: stamp(t), version: REQUEST_RECORDS_VERSION } : {}),
    ...(t.agentId ? { agentId: t.agentId } : {}),
    ...body,
  });
}

function shape(t, shapeHash, system, tools) {
  requestRecord(t, "api-request-shape", {
    shapeHash,
    shape: { system: system.map((value) => ({ type: "text", text: value })), tools },
  });
}

function blob(t, hash, content) {
  requestRecord(t, "api-request-blob", { hash, message: { role: "user", content } }, false);
}

function request(t, id, base, shapeHash, tail) {
  requestRecord(t, "api-request", {
    id,
    ...(base ? { base } : {}),
    shapeHash,
    params: {
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      betas: ["synthetic-context-beta-2026-01-01", "synthetic-tools-beta-2026-02-01"],
      context_management: { edits: [{ type: "clear_thinking", keep: "all" }] },
      output_config: { effort: "high" },
      safeguards: [{ type: "classifier", classifier_context: { v: 1 } }],
    },
    keep: 2,
    tail,
    cacheControl: [
      { path: ["system", 0], value: { type: "ephemeral" } },
      { path: ["system", 1], value: { type: "ephemeral", ttl: "1h" } },
      { path: ["tools", -1], value: { type: "ephemeral" } },
    ],
    requestDigest: `synthetic-digest-${id}`,
    querySource: t.agentId ? "agent:builtin:Explore" : "repl_main_thread",
  });
}

const tool = (name, description, properties, required = []) => ({
  name,
  description,
  input_schema: { type: "object", properties, required },
});

const readTool = tool(
  "Read",
  "Read a file from the synthetic workspace.",
  {
    file_path: { type: "string", description: "Absolute path to the file." },
    limit: { type: "number", description: "Lines to read." },
  },
  ["file_path"],
);
const tools = [
  readTool,
  tool(
    "Edit",
    "Replace text in a file.",
    {
      file_path: { type: "string", description: "Absolute path to the file." },
      old_string: { type: "string", description: "Text to replace." },
      new_string: { type: "string", description: "Replacement text." },
    },
    ["file_path", "old_string", "new_string"],
  ),
  tool(
    "Agent",
    "Launch a subagent for a focused task.",
    {
      subagent_type: { type: "string", enum: ["Explore", "general-purpose"] },
      prompt: { type: "string", description: "The task." },
    },
    ["prompt"],
  ),
];

/** A prompt, a foreground Explore subagent and an answer, with request records in both files. */
export function buildClaudeRequestLogSession() {
  const base = {
    sessionId: claudeRequestLogSessionId,
    cwd: "C:/synthetic/beacon",
    branch: "fixture/request-log",
    start: "2026-10-16T09:00:00.000Z",
  };
  const usage = { input: 4, cacheRead: 18000, cacheWrite: 1600, output: 120 };
  const t = new Transcript({ ...base, namespace: "0c1a000c" });
  const task = "Find where the beacon interval is configured.";
  t.prompt("Make the beacon interval configurable. All content is synthetic.");
  shape(
    t,
    "synthetic-shape-main",
    [
      "You are a synthetic coding agent working in a fixture repository.",
      "Environment: synthetic platform, synthetic shell. Today's date is not real.",
    ],
    tools,
  );
  blob(t, "synthetic-blob-1", "<system-reminder>Synthetic project instructions.</system-reminder>");
  blob(t, "synthetic-blob-2", "Make the beacon interval configurable.");
  request(t, "synthetic-req-1", null, "synthetic-shape-main", [
    "synthetic-blob-1",
    "synthetic-blob-2",
  ]);
  t.call(
    "msg_beacon_1",
    [
      toolUse("toolu_beacon_agent", "Agent", {
        subagent_type: "Explore",
        description: "Find the interval",
        prompt: task,
      }),
    ],
    usage,
    "tool_use",
  );
  t.toolResult(
    "toolu_beacon_agent",
    [{ type: "text", text: "It is a constant in src/beacon.ts." }],
    {
      status: "completed",
      agentId,
      prompt: task,
      content: [{ type: "text", text: "It is a constant in src/beacon.ts." }],
      totalDurationMs: 14000,
      totalTokens: 900,
      totalToolUseCount: 1,
    },
  );
  blob(t, "synthetic-blob-3", "It is a constant in src/beacon.ts.");
  request(t, "synthetic-req-3", "synthetic-req-1", "synthetic-shape-main", ["synthetic-blob-3"]);
  t.call(
    "msg_beacon_2",
    [text("The interval is a constant in src/beacon.ts; I'll read it next.")],
    usage,
    "end_turn",
  );
  t.prompt("Go ahead.");
  request(t, "synthetic-req-4", "synthetic-req-3", "synthetic-shape-main", []);
  t.call("msg_beacon_3", [text("Moved the interval into the settings file.")], usage, "end_turn");
  t.bookkeeping({ type: "ai-title", aiTitle: "SYNTHETIC · Recorded requests" });
  t.costState(0.09, { input: 16, cacheRead: 54000, cacheWrite: 4800, output: 400 });

  const agent = new Transcript({ ...base, namespace: "0c1a000d", agentId });
  agent.prompt(task);
  shape(agent, "synthetic-shape-explore", ["You are a synthetic Explore agent."], [readTool]);
  request(agent, "synthetic-req-2", null, "synthetic-shape-explore", ["synthetic-blob-a1"]);
  agent.call("msg_beacon_agent_1", [text("It is a constant in src/beacon.ts.")], usage, null);

  const dir = `projects/C--synthetic-beacon/${t.sessionId}`;
  const meta = {
    agentType: "Explore",
    description: "Find the interval",
    toolUseId: "toolu_beacon_agent",
    spawnDepth: 1,
    requestShape: "foreground",
  };
  return {
    id: claudeRequestLogSessionId,
    title: "SYNTHETIC · Recorded requests",
    files: [
      { path: `${dir}.jsonl`, content: t.toJsonl() },
      { path: `${dir}/subagents/agent-${agentId}.jsonl`, content: agent.toJsonl() },
      { path: `${dir}/subagents/agent-${agentId}.meta.json`, content: `${JSON.stringify(meta)}\n` },
    ],
  };
}
