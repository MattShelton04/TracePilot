// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Tool payloads contain literal TypeScript template strings.
/**
 * Sanitized, deterministic Copilot tool contracts shared by native JSONL and
 * frontend screenshots. Reconstructed from the versioned CLI fixtures and
 * renderer parser tests; no user session text, paths, credentials or URLs.
 * Keep the registry coverage test in sync when adding a renderer.
 */
export const richToolsSessionId = "72510000-0000-4000-8000-000000000001";
export const fixtureTime = "2026-03-20T10:00:00.000Z";
const agent = "72510000-0000-4000-8000-000000000002";
const reviewer = "72510000-0000-4000-8000-000000000003";
const source = "export function greeting(name: string) {\n  return `Hello, ${name}`;\n}\n";
const patch =
  "*** Begin Patch\n*** Update File: src/greeting.ts\n@@\n-  return `Hello, ${name}`;\n+  return `Welcome, ${name}`;\n*** Add File: src/ready.ts\n+export const ready = true;\n*** Delete File: src/legacy.ts\n*** End Patch";
const searchBody = [
  "## Cache behavior in a desktop application",
  "A cached response must preserve **the complete tool envelope** before it can be parsed. [1]",
  ...Array.from(
    { length: 10 },
    (_, i) =>
      `### Observation ${i + 1}\nKeep the session identity, input arguments, and complete response together. This deterministic example exercises long JSON, source citations, and readable wrapping without any private content. [${(i % 2) + 1}]`,
  ),
  "### Sources",
  "- [Fixture cache guide](https://example.com/cache-guide)",
  "- [Fixture response format](https://example.com/response-format)",
].join("\n\n");

const sample = (id, toolName, args, content, selector, extra = {}) => ({
  id,
  toolName,
  arguments: args,
  content,
  selector,
  ...extra,
});

export const richToolSamples = [
  sample(
    "edit",
    "edit",
    {
      path: "C:/synthetic/orchard/src/greeting.ts",
      old_str: source,
      new_str: source.replace("Hello", "Welcome"),
    },
    "The file C:/synthetic/orchard/src/greeting.ts has been successfully updated.",
    ".diff-table",
  ),
  sample(
    "view",
    "view",
    { path: "C:/synthetic/orchard/src/greeting.ts", view_range: [1, 3] },
    source
      .split("\n")
      .filter(Boolean)
      .map((line, i) => `${i + 1}. ${line}`)
      .join("\n"),
    ".code-block",
  ),
  sample(
    "create",
    "create",
    {
      path: "C:/synthetic/orchard/src/ready.ts",
      file_text: "export const ready = true;\nexport const label = 'Ready — café 日本語';\n",
    },
    "Successfully created C:/synthetic/orchard/src/ready.ts",
    ".code-block",
  ),
  sample(
    "grep",
    "grep",
    { pattern: "greeting", path: "C:/synthetic/orchard", output_mode: "content", "-n": true },
    "C:\\synthetic\\orchard\\src\\greeting.ts:1:export function greeting(name: string) {\nC:\\synthetic\\orchard\\src\\greeting.ts-2-  return `Hello, ${name}`;\n--\nC:\\synthetic\\orchard\\tests\\greeting.test.ts:4:expect(greeting('reader')).toBe('Hello, reader');",
    ".grep-result",
  ),
  sample(
    "rg",
    "rg",
    { pattern: "ready", path: "src", output_mode: "content" },
    "src/ready.ts:1:export const ready = true;\nsrc/app.ts:8:if (ready) render();",
    ".grep-result",
  ),
  sample(
    "glob",
    "glob",
    { pattern: "**/*.ts", path: "C:/synthetic/orchard" },
    "C:/synthetic/orchard/src/greeting.ts\nC:/synthetic/orchard/src/ready.ts\nC:/synthetic/orchard/src/components/status.ts\nC:/synthetic/orchard/tests/greeting.test.ts",
    ".glob-tree",
  ),
  sample(
    "powershell",
    "powershell",
    { command: "pnpm test", description: "Run the synthetic greeting tests" },
    "\u001b[32mPASS\u001b[0m tests/greeting.test.ts\n  ✓ greets a reader\n  ✓ keeps Unicode intact\n\nTest Files  1 passed (1)\nTests       2 passed (2)\nProcess exited with code 0",
    ".shell-output",
  ),
  sample(
    "read-powershell",
    "read_powershell",
    { shellId: "fixture-shell-1", delay: 1 },
    "Building desktop fixture…\nCompiled 18 modules.\nProcess exited with code 0",
    ".shell-output",
  ),
  sample(
    "write-powershell",
    "write_powershell",
    { shellId: "fixture-shell-1", chars: "y\n" },
    "Continue? [y/N] y\nConfiguration saved.\nProcess exited with code 0",
    ".shell-output",
  ),
  sample(
    "sql",
    "sql",
    {
      query: "SELECT title, status, priority FROM todos ORDER BY priority",
      description: "Inspect pending fixture tasks",
    },
    "| title | status | priority |\n| --- | --- | --- |\n| Inspect cache | done | 1 |\n| Add regression coverage | in_progress | 2 |\n| Review Unicode labels — café 日本語 | pending | 3 |",
    ".sql-data-table",
  ),
  sample(
    "web-search",
    "web_search",
    { query: "synthetic cache response contract" },
    JSON.stringify({ text: { value: searchBody } }),
    ".ws-source-card",
    { assertion: "complete-web-search" },
  ),
  sample(
    "store-memory",
    "store_memory",
    {
      subject: "fixture repository",
      fact: "Greeting tests live in tests/greeting.test.ts and run with pnpm test.",
      reason: "Keep later synthetic reviews consistent.",
      citations: "src/greeting.ts:1; tests/greeting.test.ts:4",
    },
    "Memory stored successfully.",
    ".memory-card",
  ),
  sample(
    "report-intent",
    "report_intent",
    { intent: "Verify every rich tool renderer using sanitized fixture data" },
    "Intent logged",
    ".intent-renderer",
    { openArgs: true },
  ),
  sample(
    "ask-user",
    "ask_user",
    {
      question: "Which fixture should the review cover?",
      choices: ["All renderers", "Only changed renderers", "Failed tool calls"],
      allow_freeform: true,
    },
    "User selected: All renderers",
    ".askuser-result",
  ),
  sample(
    "ask-user-schema",
    "ask_user",
    {
      message: "Choose the visual review settings.",
      requestedSchema: {
        type: "object",
        properties: {
          viewport: { type: "string", title: "Viewport", enum: ["Desktop", "Minimum", "Large"] },
          includeErrors: { type: "boolean", title: "Include error states" },
        },
        required: ["viewport"],
      },
    },
    JSON.stringify({ viewport: "Desktop", includeErrors: true }),
    ".askuser-schema-section",
  ),
  sample(
    "read-agent",
    "read_agent",
    { agent_id: agent, wait: true, timeout: 30 },
    `Agent is idle (waiting for messages). agent_id: ${agent}, agent_type: general-purpose, status: idle, description: Review synthetic renderer coverage, elapsed: 20s, total_turns: 2, model: gpt-4.1\n\n[Turn 0]\nAll expected renderer contracts are covered.\n\n[Turn 1]\n[Message from ${reviewer}]\nCheck narrow viewport wrapping.\n\n[Response]\nThe narrow review includes **960 × 640** and Unicode labels.`,
    ".ra-body",
  ),
  sample(
    "write-agent",
    "write_agent",
    {
      agent_ids: [agent, reviewer],
      message: "Review wrapping and source cards at the minimum viewport.",
    },
    `Message delivered to 2 agents.\n- ${agent}, delivered, task_status=running\n- ${reviewer}, not accepting messages`,
    ".wa-body",
  ),
  sample(
    "list-agents",
    "list_agents",
    { scope: "children" },
    `Background agents (scope: children):\n\nRunning (1):\n  🔄 renderer-review (${agent}): general-purpose - "Review synthetic renderer coverage" (20s, owner: fixture, relation: child) (model: gpt-4.1)\n\nCompleted (1):\n  ✅ layout-review (${reviewer}): explore - "Check minimum viewport" (12s, owner: fixture, relation: child) (model: gpt-4.1)`,
    ".la-agent",
  ),
  sample(
    "apply-patch",
    "apply_patch",
    patch,
    "Success. Updated the following files:\nM src/greeting.ts\nA src/ready.ts\nD src/legacy.ts",
    ".patch-file-card",
  ),
  sample(
    "web-fetch-fallback",
    "web_fetch",
    { url: "https://example.com/fixture-guide" },
    "# Synthetic guide\n\nThe fetched page describes fixture-only review data.\n\n- Inspect the complete result.\n- Keep all external requests disabled during visual capture.",
    ".tool-markdown-result",
    { registered: false, fallback: "Markdown" },
  ),
  sample(
    "task-fallback",
    "task",
    {
      description: "Review fixture coverage",
      prompt: "Read the synthetic greeting test and report its behavior.",
      agent_type: "explore",
    },
    "The greeting test covers ordinary and Unicode names. No changes are required.",
    ".tool-markdown-result",
    {
      registered: false,
      // Native reconstruction names a started task after its agent (explore).
      // Subagent metadata preserves its Markdown result presentation.
      fallback: "delegated Markdown",
      subagent: {
        agentName: "explore",
        agentDisplayName: "Fixture review",
        agentDescription: "Review fixture coverage",
        model: "gpt-4.1",
        totalToolCalls: 0,
        totalTokens: 420,
        durationMs: 2000,
      },
    },
  ),
  sample(
    "shell-error",
    "powershell",
    { command: "Get-Content missing-fixture.txt", description: "Exercise a failed tool result" },
    "Get-Content: Cannot find path 'C:/synthetic/orchard/missing-fixture.txt' because it does not exist.\nProcess exited with code 1",
    ".shell-output",
    { success: false, error: { message: "Synthetic missing-file error", code: "ENOENT" } },
  ),
  sample(
    "ask-user-pending",
    "ask_user",
    {
      question: "Ready to review the fixture screenshots?",
      choices: ["Review now", "Review later"],
    },
    null,
    ".askuser-args",
    { openArgs: true },
  ),
  sample(
    "edit-pending",
    "edit",
    { path: "src/greeting.ts", old_str: "Hello", new_str: "Welcome" },
    null,
    ".edit-args",
    { openArgs: true },
  ),
  sample(
    "create-pending",
    "create",
    { path: "src/ready.ts", file_text: "export const ready = true;" },
    null,
    ".create-args",
    { openArgs: true },
  ),
  sample(
    "write-agent-pending",
    "write_agent",
    { agent_id: agent, message: "Please review the fixture source cards." },
    null,
    ".wa-args",
    { openArgs: true },
  ),
  sample("apply-patch-pending", "apply_patch", patch, null, ".patch-file-card", { openArgs: true }),
];

// Canonical results remain complete in JSONL. Browser previews mirror the Rust
// reconstructor's 1024-byte UTF-8 boundary (web_search keeps its full envelope).
export function richToolPreview(item) {
  if (Object.hasOwn(item, "previewContent")) return item.previewContent;
  if (item.content == null || item.toolName === "web_search") return item.content;
  const encoder = new TextEncoder();
  if (encoder.encode(item.content).length <= 1024) return item.content;
  let bytes = 0;
  let preview = "";
  for (const character of item.content) {
    const size = encoder.encode(character).length;
    if (bytes + size > 1024) break;
    preview += character;
    bytes += size;
  }
  return `${preview}…[truncated]`;
}

const variant = (baseId, id, extra) => {
  const base = richToolSamples.find((item) => item.id === baseId);
  if (!base) throw new Error(`Unknown base fixture: ${baseId}`);
  return { ...base, assertion: undefined, openArgs: undefined, id, ...extra };
};
const full = { type: "full" };
const expand = (name) => ({ type: "button", name });
const longView = Array.from(
  { length: 2011 },
  (_, i) => `${i + 40}. export const fixture_${i + 40} = ${i};`,
).join("\n");
const longShell = `${Array.from(
  { length: 60 },
  (_, i) => `tick ${i + 1}: fixture module ${String(i + 1).padStart(2, "0")} compiled successfully`,
).join("\n")}\nFINAL SHELL MARKER\n<shellId: 0 completed with exit code 0>`;
const longRows = JSON.stringify(
  Array.from({ length: 220 }, (_, i) => ({
    row: i + 1,
    label: `Fixture result ${i + 1}`,
    value: i % 3 === 0 ? null : i * 1.5,
  })),
);
const longAgent =
  `Agent is idle (waiting for messages). agent_id: ${agent}, agent_type: general-purpose, status: idle, description: Review complete synthetic transcript, elapsed: 32s, total_turns: 7, model: gpt-4.1\n\n` +
  Array.from(
    { length: 7 },
    (_, i) =>
      `[Turn ${i}]\n[Message from ${reviewer}]\nReview fixture group ${i + 1}.\n\n[Response]\n### Review ${i + 1}\n${"The response preserves parameters, output and completion state. ".repeat(10)}\nEnd of turn ${i}.`,
  ).join("\n\n");
const longRoster =
  "Background agents (scope: children):\n\nRunning (12):\n" +
  Array.from(
    { length: 12 },
    (_, i) =>
      `  🔄 review-${i + 1} (72510000-0000-4000-8000-${String(i + 10).padStart(12, "0")}): general-purpose - "Review the synthetic renderer and preserve full long descriptions for group ${i + 1}" (20s, owner: fixture, relation: child) (model: gpt-4.1)`,
  ).join("\n");
const longFallback = `${Array.from(
  { length: 45 },
  (_, i) => `Fallback line ${i + 1}: unrecognized tool output stays complete and readable.`,
).join("\n")}\nFINAL FALLBACK MARKER`;

richToolSamples.push(
  variant("edit", "edit-deletion", {
    arguments: { path: "src/greeting.ts", old_str: "remove this line\n", new_str: "" },
    content: "Successfully removed the selected source.",
    viewState: "empty replacement deletes selected excerpt",
  }),
  variant("edit", "edit-error", {
    content: "The requested old_str was not found. No file was changed.",
    success: false,
    error: { message: "Match not found" },
    viewState: "failed edit retains proposed source and response",
  }),
  variant("view", "view-preview", {
    arguments: { path: "src/large.ts", view_range: [40, -1] },
    content: longView,
    viewState: "1024-byte source preview",
  }),
  variant("view", "view-full", {
    arguments: { path: "src/large.ts", view_range: [40, -1] },
    content: longView,
    actions: [full],
    viewState: "fetched source · first page",
  }),
  variant("view", "view-page", {
    arguments: { path: "src/large.ts", view_range: [40, -1] },
    content: longView,
    actions: [full, { type: "button", name: "Next", within: ".code-block-collapsed" }],
    expectText: "fixture_2050",
    viewState: "fetched source · final nonoverlapping page",
  }),
  variant("create", "create-empty", {
    arguments: { path: "src/empty.txt", file_text: "" },
    content: "Successfully created src/empty.txt",
    viewState: "empty file",
  }),
  variant("create", "create-error", {
    content: "Permission denied. The file was not created.",
    success: false,
    error: { message: "Write permission denied" },
    viewState: "failed create retains proposed contents",
  }),
  variant("create-pending", "create-args-long", {
    arguments: {
      path: "src/long-proposal.ts",
      file_text: `${source.repeat(25)}// END OF PROPOSED SOURCE`,
    },
    openArgs: true,
    viewState: "complete pending source parameters",
  }),
  variant("grep", "grep-count", {
    arguments: { pattern: "ready", output_mode: "count" },
    content: "README:2\nsrc/status.ts:12\nconstructor:1",
    viewState: "count mode and root filenames",
  }),
  variant("grep", "grep-no-match", { content: "No matches found.", viewState: "no matches" }),
  variant("grep", "grep-long", {
    content: `src/long.ts:4:const longValue = '${"x".repeat(720)}greeting';\nsrc/long.ts-5-// full context remains visible`,
    viewState: "long match and context tails",
  }),
  variant("glob", "glob-empty", { content: "No files found.", viewState: "no matching files" }),
  variant("powershell", "shell-running-empty", {
    content: null,
    selector: ".shell-output",
    viewState: "running invocation before first output",
  }),
  variant("powershell", "shell-async-running", {
    arguments: {
      command: "1..3 | ForEach-Object { Write-Output $_; Start-Sleep 1 }",
      mode: "async",
    },
    content: "tick 1\n<shellId: 0 running>",
    viewState: "completed async invocation with process still running",
  }),
  variant("powershell", "shell-empty-completed", {
    content: "",
    viewState: "completed invocation with empty output",
  }),
  variant("powershell", "shell-preview", {
    content: longShell,
    viewState: "1024-byte terminal preview",
  }),
  variant("powershell", "shell-full", {
    content: longShell,
    actions: [full, expand("Show all output")],
    focus: "end",
    expectText: "FINAL SHELL MARKER",
    viewState: "fetched full terminal output · expanded end",
  }),
  variant("read-powershell", "read-shell-running", {
    content: "tick 2\n<shellId: 0 running>",
    arguments: { shellId: "0", delay: 1 },
    viewState: "read completed while shell runs",
  }),
  variant("sql", "sql-mixed", {
    content:
      '[{"id":1,"label":"","value":null,"data":{"ready":true}},{"id":2,"later":false,"value":23.5}]',
    viewState: "heterogeneous columns, null, empty, missing and nested values",
  }),
  variant("sql", "sql-empty", {
    content: "[]",
    selector: ".sql-empty",
    viewState: "empty query result",
  }),
  variant("sql", "sql-preview", {
    content: longRows,
    selector: ".sql-plain-output",
    viewState: "truncated JSON preview remains faithful",
  }),
  variant("sql", "sql-expanded", {
    content: longRows,
    actions: [
      full,
      expand("Show all rows"),
      { type: "button", name: "Next", within: ".sql-pagination" },
    ],
    expectText: "Fixture result 220",
    focus: "end",
    viewState: "fetched table · expanded final page",
  }),
  variant("sql", "sql-prose", {
    content:
      "Query complete.\n| label | amount |\n| --- | ---: |\n| a\\|b | 9007199254740993 |\n| `x|y` | 2 |\n2 rows affected.",
    viewState: "escaped pipes and surrounding response text",
  }),
  variant("web-search", "web-search-expanded", {
    actions: [expand("Show all search response")],
    focus: "end",
    expectText: "Observation 10",
    viewState: "complete search body · expanded end",
  }),
  variant("web-search", "web-search-text-array", {
    content: JSON.stringify({
      content: [
        {
          type: "text",
          text: "## Known text envelope\n\n1. Preserve **lists**.\n2. Preserve `code`.\n\n```ts\nconst complete = true;\n```\n\n[Guide with parentheses](https://example.com/guide_(reference))",
        },
      ],
      trace: "synthetic-metadata",
    }),
    viewState: "text-array envelope and balanced source URL",
  }),
  variant("web-search", "web-search-unknown", {
    content: '{"unexpected":{"response":"Keep unrecognized content intact"}}',
    selector: ".ws-raw-body",
    viewState: "unknown JSON envelope remains readable",
  }),
  variant("store-memory", "memory-error", {
    content: "Memory was not stored: storage is unavailable.",
    success: false,
    error: { message: "Storage unavailable" },
    arguments: {
      subject: "fixture repository",
      fact: "A long memory fact remains visible with arbitrary citation forms.",
      citations: ["src/a.ts:1", "src/b.ts:2"],
    },
    viewState: "failed memory with citation array",
  }),
  variant("ask-user-schema", "ask-schema-unknown", {
    content:
      '{"viewport":"Minimum","includeErrors":false,"unrecognized":{"reason":"Preserve this answer too"}}',
    viewState: "schema answers retain unmatched fields",
  }),
  variant("read-agent", "read-agent-preview", {
    content: longAgent,
    viewState: "partial transcript preview",
  }),
  variant("read-agent", "read-agent-expanded", {
    content: longAgent,
    actions: [full, expand("Show all 7-turn agent transcript")],
    expectText: "End of turn 6.",
    focus: "end",
    viewState: "complete seven-turn transcript · expanded end",
  }),
  variant("write-agent", "write-agent-unparsed", {
    content: "Delivery outcome is unavailable; keep this exact response.",
    viewState: "unknown delivery response remains visible",
  }),
  variant("list-agents", "list-agents-long", {
    content: longRoster,
    actions: [full],
    viewState: "full long roster with distinct identifiers",
  }),
  variant("apply-patch", "patch-error", {
    content: "Patch rejected: src/greeting.ts changed since it was read.",
    success: false,
    error: { message: "Patch context mismatch" },
    viewState: "failed patch preserves actual result",
  }),
  variant("apply-patch", "patch-raw-expanded", {
    actions: [expand("Show raw patch")],
    selector: ".patch-raw",
    viewState: "raw patch disclosure open",
  }),
  variant("web-fetch-fallback", "fallback-preview", {
    toolName: "fixture_tool",
    selector: ".plain-text-renderer",
    fallback: "plain",
    content: longFallback,
    viewState: "unknown renderer · 1024-byte preview",
  }),
  variant("web-fetch-fallback", "fallback-full", {
    toolName: "fixture_tool",
    selector: ".plain-text-renderer",
    fallback: "plain",
    content: longFallback,
    actions: [full, expand("Show all output")],
    expectText: "FINAL FALLBACK MARKER",
    focus: "end",
    viewState: "unknown renderer · fetched expanded end",
  }),
  variant("web-fetch-fallback", "fallback-empty", {
    toolName: "fixture_tool",
    selector: ".plain-text-renderer",
    fallback: "plain",
    content: "",
    viewState: "unknown renderer · completed empty output",
  }),
);

export function richToolTurn(item, index = 0) {
  return {
    turnIndex: index,
    userMessage: `Rich tool fixture: ${item.id}. All content is synthetic.`,
    assistantMessages: [],
    model: "gpt-4.1",
    isComplete: true,
    toolCalls: [
      {
        toolCallId: `fixture-${item.id}`,
        toolName: item.subagent?.agentName ?? item.toolName,
        arguments: item.arguments,
        success: item.content == null ? null : item.success !== false,
        isComplete: item.content != null,
        resultContent: richToolPreview(item),
        startedAt: fixtureTime,
        completedAt: item.content == null ? null : fixtureTime,
        durationMs: item.content == null ? null : 120,
        ...(item.subagent
          ? {
              isSubagent: true,
              agentStatus: "completed",
              agentDisplayName: item.subagent.agentDisplayName,
              agentDescription: item.subagent.agentDescription,
              model: item.subagent.model,
              totalToolCalls: item.subagent.totalToolCalls,
              totalTokens: item.subagent.totalTokens,
              durationMs: item.subagent.durationMs,
            }
          : {}),
        ...(item.error ? { error: item.error.message } : {}),
      },
    ],
  };
}

export function buildRichToolsSession() {
  const events = [];
  const add = (type, data) => {
    const index = events.length;
    const id = (i) => `72510000-0000-4001-8000-${String(i).padStart(12, "0")}`;
    events.push({
      id: id(index),
      parentId: index ? id(index - 1) : null,
      timestamp: new Date(Date.parse(fixtureTime) + index * 1000).toISOString(),
      type,
      data,
    });
  };
  add("session.start", {
    sessionId: richToolsSessionId,
    version: 3,
    producer: "tracepilot-synthetic",
    copilotVersion: "1.0.88",
    startTime: fixtureTime,
    selectedModel: "gpt-4.1",
    context: {
      cwd: "C:/synthetic/orchard",
      repository: "example/orchard",
      branch: "fixture/rich-tools",
      hostType: "github",
    },
  });
  for (const [index, item] of richToolSamples.entries()) {
    const turnId = `turn-${index}`;
    add("user.message", {
      turnId,
      content: `Rich tool fixture: ${item.id}. All content is synthetic.`,
    });
    add("assistant.turn_start", { turnId, model: "gpt-4.1" });
    add("tool.execution_start", {
      turnId,
      toolCallId: `fixture-${item.id}`,
      toolName: item.toolName,
      arguments: item.arguments,
    });
    if (item.subagent)
      add("subagent.started", {
        toolCallId: `fixture-${item.id}`,
        agentName: item.subagent.agentName,
        agentDisplayName: item.subagent.agentDisplayName,
        agentDescription: item.subagent.agentDescription,
        model: item.subagent.model,
      });
    if (item.content != null)
      add("tool.execution_complete", {
        turnId,
        toolCallId: `fixture-${item.id}`,
        success: item.success !== false,
        result: { content: item.content },
        ...(item.error ? { error: item.error } : {}),
      });
    if (item.subagent)
      add("subagent.completed", {
        toolCallId: `fixture-${item.id}`,
        ...item.subagent,
      });
    add("assistant.turn_end", { turnId });
  }
  add("session.shutdown", {
    shutdownType: "routine",
    currentModel: "gpt-4.1",
    totalApiDurationMs: events.length * 1000,
    sessionStartTime: Date.parse(fixtureTime),
    codeChanges: {
      linesAdded: 4,
      linesRemoved: 2,
      filesModified: ["src/greeting.ts", "src/ready.ts"],
    },
    modelMetrics: {
      "gpt-4.1": {
        requests: { count: richToolSamples.length, cost: 0 },
        usage: {
          inputTokens: 12500,
          outputTokens: 4200,
          cacheReadTokens: 8000,
          cacheWriteTokens: 0,
        },
      },
    },
  });
  return {
    id: richToolsSessionId,
    title: "SYNTHETIC · Rich tool renderer gallery",
    events,
    expected: {
      scenarios: richToolSamples.length,
      tools: [...new Set(richToolSamples.map((item) => item.toolName))],
    },
  };
}
