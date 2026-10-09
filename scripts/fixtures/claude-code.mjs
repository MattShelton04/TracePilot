/**
 * Synthetic Claude Code sessions for `pnpm app:start -Fixtures`.
 *
 * Shapes follow docs/research/claude-code-integration/record-shapes.md and
 * mirror the Rust builder in crates/tracepilot-test-support/src/claude.rs.
 * Every id, path, text and number is invented; never copy real transcripts.
 */

import {
  buildClaudeCommandSession,
  buildClaudeCostSessions,
  buildClaudeGallery,
} from "./claude-gallery.mjs";
import { Transcript, text, thinking, toolUse } from "./claude-transcript.mjs";

export const claudeOrchardSessionId = "c1a0de00-0000-4000-8000-000000000001";
export const claudeLanternSessionId = "c1a0de00-0000-4000-8000-000000000002";
export const claudeHarborSessionId = "c1a0de00-0000-4000-8000-000000000003";

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

/**
 * Incidents and prompt-cache windows: a refused push, an interrupted push
 * after a 12-minute pause (cache still warm), then a 429 and a reply after an
 * 80-minute pause (past the 1-hour cache tier).
 */
function harborSession() {
  const t = new Transcript({
    sessionId: claudeHarborSessionId,
    cwd: "C:\\synthetic\\harbor",
    branch: "release/2.4",
    namespace: "0c1a0004",
    start: "2026-03-16T16:20:00.000Z",
  });
  const usage = { input: 2, cacheRead: 15000, cacheWrite: 1200, output: 90 };
  const push = { command: "git push origin v2.4.0", description: "Push the tag" };
  t.prompt("Tag the 2.4 release and push the tag.");
  t.call(
    "msg_harbor_1",
    [
      text("I'll create the tag first."),
      toolUse("toolu_harbor_tag", "Bash", { command: "git tag v2.4.0", description: "Tag" }),
    ],
    usage,
    "tool_use",
  );
  t.toolResult("toolu_harbor_tag", "", {
    stdout: "",
    stderr: "",
    interrupted: false,
    isImage: false,
    noOutputExpected: true,
  });
  t.call("msg_harbor_2", [toolUse("toolu_harbor_push", "Bash", push)], usage, "tool_use");
  t.denied("toolu_harbor_push", "user-rejected");
  t.call(
    "msg_harbor_3",
    [text("Tagged v2.4.0 locally; I won't push until you say so.")],
    usage,
    "end_turn",
  );
  t.record("system", { subtype: "turn_duration", durationMs: 21000, messageCount: 6 });
  t.idle(12 * 60);
  t.prompt("Go ahead and push it now.");
  t.call(
    "msg_harbor_4",
    [text("Pushing the tag."), toolUse("toolu_harbor_push_again", "Bash", push)],
    usage,
    "tool_use",
  );
  t.interrupted("toolu_harbor_push_again");
  t.idle(80 * 60);
  t.prompt("Is the tag on the remote?");
  t.rateLimited();
  t.idle(60);
  t.prompt("Try again.");
  t.call("msg_harbor_5", [text("Yes: v2.4.0 is on origin.")], usage, "end_turn");
  // Renamed with `/rename`: the latest custom title beats the later ai-title.
  t.bookkeeping({ type: "custom-title", customTitle: "Release tagging" });
  t.bookkeeping({ type: "custom-title", customTitle: "Ship 2.4" });
  t.bookkeeping({ type: "ai-title", aiTitle: "Tag the 2.4 release" });
  t.costState(0.31, { input: 10, cacheRead: 75000, cacheWrite: 6000, output: 450 });
  return {
    id: claudeHarborSessionId,
    title: "Ship 2.4",
    files: [{ path: `projects/C--synthetic-harbor/${t.sessionId}.jsonl`, content: t.toJsonl() }],
  };
}

/** Claude Code sessions, with file paths relative to its config directory. */
export function buildClaudeCodeSessions() {
  return [
    orchardSession(),
    lanternSession(),
    harborSession(),
    buildClaudeGallery(),
    ...buildClaudeCostSessions(),
    buildClaudeCommandSession(),
  ];
}
