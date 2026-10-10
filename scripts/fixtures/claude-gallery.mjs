import { Transcript, text, toolUse } from "./claude-transcript.mjs";
import { claudeToolSamples } from "./rich-tools.mjs";

export const claudeGallerySessionId = "c1a0de00-0000-4000-8000-000000000004";
export const claudeRunningCostSessionId = "c1a0de00-0000-4000-8000-000000000005";
export const claudeRecordedCostSessionId = "c1a0de00-0000-4000-8000-000000000006";
export const claudeUntieredCacheSessionId = "c1a0de00-0000-4000-8000-000000000008";
export const claudeCommandsSessionId = "c1a0de00-0000-4000-8000-000000000009";
export const claudeNotificationSessionId = "c1a0de00-0000-4000-8000-00000000000a";

const base = {
  cwd: "C:/synthetic/gallery",
  branch: "fixture/claude-cost",
  start: "2026-10-07T10:00:00.000Z",
};
const usage = { input: 10, cacheRead: 100, cacheWrite: 20, output: 5 };
function session(t, title) {
  t.bookkeeping({ type: "ai-title", aiTitle: title });
  return {
    id: t.sessionId,
    title,
    files: [{ path: `projects/C--synthetic-gallery/${t.sessionId}.jsonl`, content: t.toJsonl() }],
  };
}

export function buildClaudeGallery() {
  const t = new Transcript({ ...base, sessionId: claudeGallerySessionId, namespace: "0c1a0005" });
  for (const sample of claudeToolSamples) {
    t.prompt(`Renderer fixture: ${sample.nativeToolName}. All content is synthetic.`);
    t.call(
      sample.id,
      [toolUse(`toolu_${sample.id}`, sample.nativeToolName, sample.input)],
      usage,
      "tool_use",
    );
    t.toolResult(`toolu_${sample.id}`, sample.nativeContent, sample.toolUseResult);
    t.call(`${sample.id}_done`, [text("Done.")], usage, "end_turn");
  }
  const n = claudeToolSamples.length * 2;
  const total = (n * (10 * 4 + 100 * 0.2 + 20 * 8 + 5 * 20)) / 1e6;
  t.costState(total, { input: 10 * n, cacheRead: 100 * n, cacheWrite: 20 * n, output: 5 * n });
  t.costState(total, { input: 10 * n, cacheRead: 100 * n, cacheWrite: 20 * n, output: 5 * n });
  return session(t, "SYNTHETIC · Claude Code renderer gallery");
}

export function buildClaudeCostSessions() {
  const running = new Transcript({
    ...base,
    sessionId: claudeRunningCostSessionId,
    namespace: "0c1a0006",
  });
  running.prompt("First request.");
  running.call("cost_before", [text("First answer.")], usage, "end_turn");
  running.costState(0.00032, usage);
  running.costState(0.00032, usage);
  running.idle(600);
  running.prompt("Resume with a live tail.");
  running.call("cost_tail", [text("Still working…")], { ...usage, cacheWrite: 50 }, null);
  const recorded = new Transcript({
    ...base,
    sessionId: claudeRecordedCostSessionId,
    namespace: "0c1a0007",
  });
  recorded.prompt("Estimate recorded usage without a cost snapshot.");
  recorded.call("recorded", [text("Recorded usage only.")], usage, "end_turn");
  // Cache writes with no recorded TTL tier: the countdown reads "unknown".
  const untiered = new Transcript({
    ...base,
    sessionId: claudeUntieredCacheSessionId,
    namespace: "0c1a0008",
  });
  untiered.prompt(
    'Summarize this note:\n\n<pasted_content id="1">\nSYNTHETIC pasted note.\nThe cache tier was not recorded.\n</pasted_content id="1">',
  );
  untiered.call(
    "untiered",
    [text("The note says no cache tier was recorded.")],
    { ...usage, tier: null },
    "end_turn",
  );
  return [
    session(running, "SYNTHETIC · Resumed Claude cost with live tail"),
    session(recorded, "SYNTHETIC · Recorded usage without snapshot"),
    session(untiered, "SYNTHETIC · Cache tier not recorded"),
  ];
}

const notification = (fields) =>
  `<task-notification>\n${Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join("\n")}\n</task-notification>`;

/**
 * Background work that finishes while the session is idle: an agent and a
 * background shell start together, the model ends its turn, then one
 * `user` record carries both completions and wakes the session.
 */
export function buildClaudeNotificationSession() {
  const t = new Transcript({
    ...base,
    sessionId: claudeNotificationSessionId,
    namespace: "0c1a000a",
  });
  t.prompt("Run the slow suite in the background and map the retry call sites.");
  t.call(
    "notify_launch",
    [
      toolUse("toolu_notify_suite", "Bash", {
        command: "cargo test --test slow",
        description: "Run the slow suite",
        run_in_background: true,
      }),
      toolUse("toolu_notify_agent", "Agent", {
        subagent_type: "Explore",
        description: "Map the retry call sites",
        prompt: "Find every call site that retries.",
      }),
    ],
    usage,
    "tool_use",
  );
  t.toolResult("toolu_notify_suite", "Command running in background with ID: bnotify1", {
    stdout: "",
    stderr: "",
    interrupted: false,
    isImage: false,
    backgroundTaskId: "bnotify1",
  });
  t.toolResult("toolu_notify_agent", "Async agent launched successfully.", {
    status: "async_launched",
    isAsync: true,
    agentId: "a0c1a000a0000001",
    description: "Map the retry call sites",
  });
  t.call(
    "notify_wait",
    [text("Both are running; I'll report when they finish.")],
    usage,
    "end_turn",
  );
  t.idle(240);
  const agent = notification({
    "task-id": "a0c1a000a0000001",
    "tool-use-id": "toolu_notify_agent",
    status: "completed",
    summary: 'Agent "Map the retry call sites" finished',
    result: "SYNTHETIC report. Three call sites retry:\n\n- `upload`\n- `sync`\n- `prune`",
    usage:
      "<subagent_tokens>48200</subagent_tokens><tool_uses>14</tool_uses><duration_ms>120000</duration_ms>",
  });
  const shell = notification({
    "task-id": "bnotify1",
    "tool-use-id": "toolu_notify_suite",
    "output-file": "C:\\synthetic\\gallery\\tasks\\bnotify1.output",
    status: "failed",
    summary: 'Background command "Run the slow suite" failed with exit code 1',
  });
  for (const content of [agent, shell]) {
    t.bookkeeping({ type: "queue-operation", operation: "enqueue", content });
  }
  t.record("user", {
    origin: { kind: "task-notification" },
    turnOrigin: "task_notification",
    message: { role: "user", content: `${agent}\n${shell}` },
  });
  t.call(
    "notify_reply",
    [text("The map is in; the slow suite failed, so I'll read its output next.")],
    usage,
    "end_turn",
  );
  t.costState(0.0012, { input: 30, cacheRead: 300, cacheWrite: 60, output: 15 });
  return session(t, "SYNTHETIC · Background task notifications");
}

const CAVEAT =
  "<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>";

/** Slash commands and their output only: no prompt, no model call and no `ai-title`. */
export function buildClaudeCommandSession() {
  const t = new Transcript({ ...base, sessionId: claudeCommandsSessionId, namespace: "0c1a0009" });
  for (const [name, args, output] of [
    ["model", "claude-opus-5-5", "Set model to \u001b[1mOpus 5.5\u001b[22m"],
    ["cost", "", "Total cost: $0.00 (synthetic)"],
  ]) {
    t.record("user", { isMeta: true, message: { role: "user", content: CAVEAT } });
    const record = `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`;
    t.record("user", { message: { role: "user", content: record } });
    const stdout = `<local-command-stdout>${output}</local-command-stdout>`;
    t.record("user", { message: { role: "user", content: stdout } });
  }
  return {
    id: t.sessionId,
    title: "/model claude-opus-5-5",
    files: [{ path: `projects/C--synthetic-gallery/${t.sessionId}.jsonl`, content: t.toJsonl() }],
  };
}
