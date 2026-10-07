/**
 * Synthetic Claude Code sessions for `pnpm app:start -Fixtures`.
 *
 * Shapes follow docs/research/claude-code-integration/record-shapes.md and
 * mirror the Rust builder in crates/tracepilot-test-support/src/claude.rs.
 * Every id, path, text and number is invented; never copy real transcripts.
 */

const MODEL = "claude-opus-5-5";
const VERSION = "2.1.289";

/** Appends records with a chained `parentUuid` and a one-second clock. */
class Transcript {
  constructor({ sessionId, cwd, branch, namespace, start, agentId = null }) {
    Object.assign(this, { sessionId, cwd, branch, namespace, start, agentId });
    this.seq = 0;
    this.clock = 0;
    this.lastUuid = null;
    this.promptId = null;
    this.prompts = 0;
    this.lines = [];
  }

  uuid() {
    this.seq += 1;
    return `${this.namespace}-0000-4000-8000-${this.seq.toString(16).padStart(12, "0")}`;
  }

  timestamp() {
    this.clock += 7;
    return new Date(Date.parse(this.start) + this.clock * 1000).toISOString();
  }

  record(type, body) {
    const uuid = this.uuid();
    this.lines.push({
      type,
      uuid,
      parentUuid: this.lastUuid,
      isSidechain: this.agentId !== null,
      timestamp: this.timestamp(),
      sessionId: this.sessionId,
      cwd: this.cwd,
      gitBranch: this.branch,
      version: VERSION,
      entrypoint: "cli",
      userType: "external",
      ...(this.agentId ? { agentId: this.agentId } : {}),
      ...body,
    });
    this.lastUuid = uuid;
  }

  bookkeeping(body) {
    this.lines.push({ ...body, sessionId: this.sessionId });
  }

  prompt(text) {
    this.prompts += 1;
    this.promptId = `22222222-2222-4222-8222-${this.prompts.toString(16).padStart(12, "0")}`;
    this.record("user", {
      promptId: this.promptId,
      message: { role: "user", content: text },
      origin: { kind: "human" },
      promptSource: "typed",
      permissionMode: "auto",
    });
  }

  /** One API call, one record per content block; the last carries the usage. */
  call(messageId, blocks, usage, stopReason) {
    blocks.forEach((block, index) => {
      const last = index === blocks.length - 1;
      this.record("assistant", {
        requestId: `req_${messageId}`,
        message: {
          id: messageId,
          model: MODEL,
          role: "assistant",
          stop_reason: last ? stopReason : null,
          content: [block],
          usage: {
            input_tokens: usage.input,
            cache_read_input_tokens: usage.cacheRead,
            cache_creation_input_tokens: usage.cacheWrite,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: usage.cacheWrite,
            },
            output_tokens: last ? usage.output : Math.floor(usage.output / 2),
            output_tokens_details: { thinking_tokens: usage.thinking ?? 0 },
            service_tier: "standard",
          },
        },
      });
    });
  }

  toolResult(toolUseId, content, toolUseResult) {
    this.record("user", {
      promptId: this.promptId,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: false, content }],
      },
      toolUseResult,
    });
  }

  costState(cost, usage) {
    this.bookkeeping({
      type: "cost-state",
      totalCostUSD: cost,
      totalAPIDuration: 48000,
      totalDuration: this.clock * 1000,
      totalLinesAdded: 4,
      totalLinesRemoved: 1,
      startTime: Date.parse(this.start),
      hasUnknownModelCost: false,
      modelUsage: {
        [MODEL]: {
          inputTokens: usage.input,
          outputTokens: usage.output,
          thinkingTokens: 0,
          cacheReadInputTokens: usage.cacheRead,
          cacheCreationInputTokens: usage.cacheWrite,
          webSearchRequests: 0,
          costUSD: cost,
        },
      },
    });
  }

  toJsonl() {
    return `${this.lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  }
}

const text = (value) => ({ type: "text", text: value });
const thinking = () => ({ type: "thinking", thinking: "", signature: "c3ludGhldGlj" });
const toolUse = (id, name, input) => ({
  type: "tool_use",
  id,
  name,
  input,
  caller: { type: "direct" },
});

export const claudeOrchardSessionId = "c1a0de00-0000-4000-8000-000000000001";
export const claudeLanternSessionId = "c1a0de00-0000-4000-8000-000000000002";

function orchardSession() {
  const cwd = "C:\\synthetic\\orchard";
  const file = `${cwd}\\src\\upload.ts`;
  const t = new Transcript({
    sessionId: claudeOrchardSessionId,
    cwd,
    branch: "fixture/claude-code",
    namespace: "0c1a0001",
    start: "2026-03-14T09:30:00.000Z",
  });
  const usage = { input: 3, cacheRead: 12000, cacheWrite: 2400, output: 160 };
  const original = "export async function upload(body: Blob) {\n  return send(body);\n}\n";
  t.prompt("Add a retry to the upload client in src/upload.ts.");
  t.call(
    "msg_orchard_1",
    [
      thinking(),
      text("I'll read the upload client first."),
      toolUse("toolu_orchard_read", "Read", { file_path: file }),
    ],
    usage,
    "tool_use",
  );
  t.toolResult("toolu_orchard_read", "1\texport async function upload(body: Blob) {", {
    type: "text",
    file: { filePath: file, content: original, numLines: 3, startLine: 1, totalLines: 3 },
  });
  t.call(
    "msg_orchard_2",
    [
      toolUse("toolu_orchard_edit", "Edit", {
        file_path: file,
        old_string: "  return send(body);",
        new_string: "  return retry(() => send(body), { attempts: 3 });",
      }),
    ],
    usage,
    "tool_use",
  );
  t.toolResult("toolu_orchard_edit", `The file ${file} has been updated.`, {
    filePath: file,
    oldString: "  return send(body);",
    newString: "  return retry(() => send(body), { attempts: 3 });",
    originalFile: original,
    structuredPatch: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          " export async function upload(body: Blob) {",
          "-  return send(body);",
          "+  return retry(() => send(body), { attempts: 3 });",
          " }",
        ],
      },
    ],
    userModified: false,
    replaceAll: false,
  });
  t.call(
    "msg_orchard_3",
    [toolUse("toolu_orchard_test", "Bash", { command: "npm test", description: "Run the tests" })],
    usage,
    "tool_use",
  );
  t.toolResult("toolu_orchard_test", "12 passing", {
    stdout: "12 passing\n",
    stderr: "",
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
  });
  t.call(
    "msg_orchard_4",
    [text("Added a retry around `send` with three attempts; all 12 tests pass.")],
    usage,
    "end_turn",
  );
  t.record("system", { subtype: "turn_duration", durationMs: 42000, messageCount: 12 });
  t.bookkeeping({ type: "ai-title", aiTitle: "Add upload retries" });
  t.costState(0.42, { input: 12, cacheRead: 48000, cacheWrite: 9600, output: 640 });
  return {
    id: claudeOrchardSessionId,
    title: "Add upload retries",
    files: [{ path: `projects/C--synthetic-orchard/${t.sessionId}.jsonl`, content: t.toJsonl() }],
  };
}

function lanternSession() {
  const cwd = "C:\\synthetic\\lantern";
  const agentId = "a1b2c3d4e5f60708";
  const base = { cwd, branch: "main", start: "2026-03-15T14:05:00.000Z" };
  const t = new Transcript({ ...base, sessionId: claudeLanternSessionId, namespace: "0c1a0002" });
  const usage = { input: 2, cacheRead: 9000, cacheWrite: 1800, output: 120 };
  const task = "Find where deleted sessions are pruned from the index.";
  t.prompt("Map how the lantern indexer prunes deleted sessions.");
  t.call(
    "msg_lantern_1",
    [
      text("I'll ask an explorer agent to map it."),
      toolUse("toolu_lantern_agent", "Agent", {
        subagent_type: "Explore",
        description: "Map the pruning path",
        prompt: task,
      }),
    ],
    usage,
    "tool_use",
  );
  t.toolResult("toolu_lantern_agent", "Async agent launched successfully.", {
    status: "async_launched",
    isAsync: true,
    agentId,
    description: "Map the pruning path",
  });
  t.record("user", {
    origin: { kind: "task-notification" },
    turnOrigin: "task_notification",
    message: {
      role: "user",
      content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>toolu_lantern_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent "Map the pruning path" finished</summary>\n<usage><subagent_tokens>9600</subagent_tokens><tool_uses>1</tool_uses><duration_ms>12000</duration_ms></usage>\n</task-notification>`,
    },
  });
  t.call(
    "msg_lantern_2",
    [text("Pruning runs per source, and only after a complete inventory of that source.")],
    usage,
    "end_turn",
  );
  t.bookkeeping({ type: "ai-title", aiTitle: "Map session pruning" });
  t.costState(0.18, { input: 6, cacheRead: 27000, cacheWrite: 5400, output: 360 });

  const agent = new Transcript({
    ...base,
    sessionId: claudeLanternSessionId,
    namespace: "0c1a0003",
    agentId,
  });
  agent.prompt(task);
  agent.call(
    "msg_lantern_agent_1",
    [toolUse("toolu_lantern_grep", "Grep", { pattern: "prune_source", path: "src" })],
    usage,
    null,
  );
  agent.toolResult("toolu_lantern_grep", "Found 2 files", {
    mode: "files_with_matches",
    numFiles: 2,
    filenames: ["src\\index\\prune.rs", "src\\index\\reindex.rs"],
  });
  agent.call(
    "msg_lantern_agent_2",
    [text("prune_source deletes a source's missing sessions after its inventory completes.")],
    usage,
    null,
  );
  const dir = `projects/C--synthetic-lantern/${t.sessionId}`;
  const meta = {
    agentType: "Explore",
    description: "Map the pruning path",
    toolUseId: "toolu_lantern_agent",
    spawnDepth: 1,
    requestShape: "background",
  };
  return {
    id: claudeLanternSessionId,
    title: "Map session pruning",
    files: [
      { path: `${dir}.jsonl`, content: t.toJsonl() },
      { path: `${dir}/subagents/agent-${agentId}.jsonl`, content: agent.toJsonl() },
      { path: `${dir}/subagents/agent-${agentId}.meta.json`, content: `${JSON.stringify(meta)}\n` },
    ],
  };
}

/** Claude Code sessions, with file paths relative to its config directory. */
export function buildClaudeCodeSessions() {
  return [orchardSession(), lanternSession()];
}
