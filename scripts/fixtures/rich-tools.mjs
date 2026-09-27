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
      choices: ["All renderers", "Only changed renderers", "Metrics stress session"],
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
    ".plain-text-renderer",
    { registered: false },
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
    ".rs .markdown-content",
    {
      registered: false,
      fallback: "Markdown",
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
        resultContent: item.content,
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
