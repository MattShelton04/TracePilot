// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Synthetic source contains literal TypeScript templates.
/** Long, empty, error and interaction variants of the canonical rich tool samples. */
export function richToolVariants(richToolSamples, { agent, reviewer, source }) {
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
    (_, i) =>
      `tick ${i + 1}: fixture module ${String(i + 1).padStart(2, "0")} compiled successfully`,
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
  const annotatedSearch =
    "## Known text envelope\n\n1. Preserve **lists**.\n2. Preserve `code`.\n\n```ts\nconst complete = true;\n```\n\nFive cited sources remain available without body URLs: [1] [2] [3] [4] [5].";

  return [
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
    variant("powershell", "shell-async-completed", {
      arguments: {
        command: "pnpm build",
        description: "Build the synthetic app in the background",
        mode: "async",
        shellId: "fixture-build",
      },
      content: "<command started in background with shellId: fixture-build>",
      // The completion arrives later as a notification and settles the call.
      notification: { type: "shell_completed", shellId: "fixture-build", exitCode: 0 },
      backgroundOutcome: {
        status: "completed",
        exitCode: 0,
        completedAt: "2026-03-20T10:02:04.000Z",
      },
      viewState: "async invocation settled by its completion notification",
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
            text: {
              value: annotatedSearch,
              annotations: Array.from({ length: 5 }, (_, index) => ({
                text: `[${index + 1}]`,
                start_index: annotatedSearch.indexOf(`[${index + 1}]`),
                end_index: annotatedSearch.indexOf(`[${index + 1}]`) + 3,
                url_citation: {
                  url: `https://example.com/reference/${index + 1}`,
                  title: `Fixture reference ${index + 1}`,
                },
              })),
            },
          },
        ],
        trace: "synthetic-metadata",
      }),
      expectText: "Fixture reference 5",
      viewState: "text-array envelope with five annotation-only citations",
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
        '{"viewport":"large","includeErrors":false,"unrecognized":{"reason":"Preserve this answer too"}}',
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
  ];
}
