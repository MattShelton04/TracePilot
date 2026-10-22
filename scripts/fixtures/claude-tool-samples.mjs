/** Synthetic C4 renderer contracts. Native inputs/results drive the real provider. */
const file = "C:/synthetic/gallery/src/ready.ts";
const source = "export const ready = true;\n";
const plan =
  "# Flip the synthetic ready flag\n\n1. Set `ready` to `true` in `src/ready.ts`.\n2. Run `pnpm test`.\n\n| Step | Risk |\n| --- | --- |\n| Edit | Low |";
const hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: ["-export const ready = false;", "+export const ready = true;"],
};
const sample = (
  id,
  nativeToolName,
  toolName,
  input,
  toolUseResult,
  content,
  args,
  selector = ".tool-call-item",
) => ({
  id: `claude-${id}`,
  nativeToolName,
  toolName,
  input,
  toolUseResult,
  nativeContent: content,
  content,
  arguments: args ?? input,
  selector,
});

export const claudeToolSamples = [
  sample(
    "bash",
    "Bash",
    "shell",
    { command: "pnpm test", description: "Run tests" },
    { stdout: "PASS ready.test.ts", stderr: "", interrupted: false },
    "PASS ready.test.ts",
    undefined,
    ".shell-output",
  ),
  sample(
    "powershell",
    "PowerShell",
    "powershell",
    { command: "Get-Content src/ready.ts" },
    { stdout: source, stderr: "" },
    source,
    undefined,
    ".shell-output",
  ),
  sample(
    "read",
    "Read",
    "view",
    { file_path: file, offset: 1, limit: 1 },
    {
      type: "text",
      file: { filePath: file, content: source, startLine: 1, numLines: 1, totalLines: 1 },
    },
    "1. export const ready = true;",
    { path: file, view_range: [1, 1] },
    ".code-block",
  ),
  sample(
    "edit",
    "Edit",
    "edit",
    { file_path: file, old_string: "false", new_string: "true" },
    { filePath: file, structuredPatch: [hunk] },
    "Edited.",
    { path: file, old_str: "false", new_str: "true" },
    ".diff-table",
  ),
  sample(
    "create",
    "Write",
    "create",
    { file_path: file, content: source },
    { type: "create", filePath: file },
    "Created.",
    { path: file, file_text: source },
    ".code-block",
  ),
  sample(
    "overwrite",
    "Write",
    "apply_patch",
    { file_path: file, content: source },
    { type: "update", filePath: file, structuredPatch: [hunk] },
    "Updated.",
    {
      patch: `*** Begin Patch\n*** Update File: ${file}\n@@\n-export const ready = false;\n+export const ready = true;\n*** End Patch`,
    },
    ".patch-file-card",
  ),
  // Unverified historical shape: MultiEdit is not in the current built-in tool list.
  sample(
    "multi-edit",
    "MultiEdit",
    "apply_patch",
    { file_path: file, edits: [{ old_string: "false", new_string: "true" }] },
    { filePath: file, structuredPatch: [hunk] },
    "Edited.",
    {
      patch: `*** Begin Patch\n*** Update File: ${file}\n@@\n-export const ready = false;\n+export const ready = true;\n*** End Patch`,
    },
    ".patch-file-card",
  ),
  sample(
    "grep",
    "Grep",
    "grep",
    { pattern: "ready", path: "src", "-i": true, output_mode: "content", "-n": true },
    { mode: "content", content: `${file}:1:export const ready = true;` },
    `${file}:1:export const ready = true;`,
    { pattern: "ready", path: "src", ignore_case: true, output_mode: "content", "-n": true },
    ".grep-result",
  ),
  sample(
    "glob",
    "Glob",
    "glob",
    { pattern: "**/*.ts", path: "src" },
    { filenames: [file] },
    file,
    undefined,
    ".glob-tree",
  ),
  sample(
    "agent",
    "Agent",
    "task",
    { prompt: "Inspect ready.ts", subagent_type: "Explore", description: "Inspect readiness" },
    { status: "completed" },
    "The flag is ready.",
    { prompt: "Inspect ready.ts", agent_type: "Explore", description: "Inspect readiness" },
    ".tool-call-item",
  ),
  sample(
    "send-message",
    "SendMessage",
    "write_agent",
    { to: "reviewer", message: "Check the flag." },
    {},
    "Message delivered.",
    { agent_id: "reviewer", message: "Check the flag." },
  ),
  sample(
    "stop-agent",
    "TaskStop",
    "stop_agent",
    { task_id: "worker" },
    { task_type: "local_agent" },
    "Stopped.",
    { agent_id: "worker" },
  ),
  sample(
    "stop-shell",
    "TaskStop",
    "stop_powershell",
    { task_id: "shell-1" },
    { task_type: "local_bash" },
    "Stopped.",
    { shellId: "shell-1" },
  ),
  sample("kill-shell", "KillShell", "stop_powershell", { shell_id: "shell-2" }, {}, "Stopped.", {
    shellId: "shell-2",
  }),
  sample(
    "fetch",
    "WebFetch",
    "web_fetch",
    { url: "https://example.com/ready", prompt: "Summarize." },
    { result: "# Readiness\nThe synthetic flag is ready." },
    "# Readiness\nThe synthetic flag is ready.",
    undefined,
    ".tool-markdown-result",
  ),
  sample(
    "search",
    "WebSearch",
    "web_search",
    { query: "synthetic readiness" },
    {
      query: "synthetic readiness",
      results: [
        "Readiness",
        { content: [{ title: "Readiness", url: "https://example.com/ready" }] },
      ],
    },
    JSON.stringify({
      text: {
        value: "Readiness",
        annotations: [
          {
            type: "url_citation",
            url_citation: { url: "https://example.com/ready", title: "Readiness" },
          },
        ],
      },
    }),
    undefined,
    ".ws-source-card",
  ),
  sample(
    "skill",
    "Skill",
    "skill",
    { skill: "synthetic-review" },
    {},
    "Review the synthetic readiness flag.",
  ),
  sample(
    "ask",
    "AskUserQuestion",
    "ask_user",
    {
      questions: [
        {
          question: "Which flag?",
          header: "Flag",
          options: [
            { label: "Ready", description: "Use ready." },
            { label: "Pending", description: "Use pending." },
          ],
          multiSelect: false,
        },
      ],
    },
    { answers: { "Which flag?": "Ready" } },
    JSON.stringify({ q1: "Ready" }),
    {
      // The provider gives a single question's text as `message`.
      message: "Which flag?",
      requestedSchema: {
        type: "object",
        properties: {
          q1: {
            type: "string",
            title: "Which flag?",
            oneOf: [
              { const: "Ready", title: "Ready" },
              { const: "Pending", title: "Pending" },
            ],
          },
        },
      },
    },
    ".askuser-result",
  ),
  sample(
    "exit-plan-mode",
    "ExitPlanMode",
    "ExitPlanMode",
    { plan },
    { plan, isAgent: false },
    "User has approved your plan. You can now start coding.",
    undefined,
    ".plan-markdown",
  ),
  // Task lists. Inputs follow each tool's published schema; result texts are synthetic.
  sample(
    "update-plan",
    "mcp__ccd_turn__update_plan",
    "mcp__ccd_turn__update_plan",
    {
      items: [
        { content: "Read the synthetic config", status: "completed" },
        { content: "Flip the ready flag", status: "in_progress" },
        { content: "Run the synthetic tests", status: "pending" },
        { content: "Add a changelog fragment", status: "pending" },
      ],
      scope: "first_task",
    },
    {},
    "Plan updated.",
    undefined,
    ".task-list",
  ),
  sample(
    "update-plan-advance",
    "mcp__ccd_turn__update_plan",
    "mcp__ccd_turn__update_plan",
    { advance: true },
    {},
    "Plan updated.",
    undefined,
    ".task-changes",
  ),
  sample(
    "wrap-up",
    "mcp__ccd_turn__wrap_up",
    "mcp__ccd_turn__wrap_up",
    {
      recap:
        "The ready flag is on and the synthetic tests pass. Nothing is committed yet.\nThe changelog fragment is still to write.",
      ask: "Commit the change?",
      actions: [
        { action: "commit" },
        { label: "Not yet", message: "Leave it uncommitted for now." },
      ],
    },
    {},
    "Recap shown with the question.",
    undefined,
    ".task-wrapup",
  ),
  // Legacy CLI tools (on by default only for older models).
  sample(
    "todo-write",
    "TodoWrite",
    "TodoWrite",
    {
      todos: [
        { content: "Flip the ready flag", status: "completed", activeForm: "Flipping the flag" },
        { content: "Run the synthetic tests", status: "in_progress", activeForm: "Running tests" },
        { content: "Add a changelog fragment", status: "pending", activeForm: "Adding a fragment" },
      ],
    },
    { oldTodos: [], newTodos: [] },
    "Todos have been modified successfully.",
    undefined,
    ".task-list",
  ),
  sample(
    "task-create",
    "TaskCreate",
    "TaskCreate",
    {
      subject: "Run the synthetic tests",
      description: "Run the suite after the ready flag flips.",
      activeForm: "Running the synthetic tests",
    },
    { task: { id: "1", subject: "Run the synthetic tests" } },
    "Task #1 created successfully: Run the synthetic tests",
    undefined,
    ".task-list",
  ),
  sample(
    "task-update",
    "TaskUpdate",
    "TaskUpdate",
    { taskId: "1", status: "completed" },
    { success: true, taskId: "1", updatedFields: ["status"] },
    "Updated task #1 status",
    undefined,
    ".task-changes",
  ),
  // Unverified public MCP shape; no server is contacted.
  sample(
    "mcp",
    "mcp__synthetic__lookup",
    "mcp__synthetic__lookup",
    { key: "ready" },
    {},
    "ready: true",
  ),
  sample("generic", "Monitor", "Monitor", { command: "watch synthetic flag" }, {}, "Ready."),
];

/**
 * Claude task-list calls still open, in the Copilot rich-tool gallery's shape:
 * the checklist is the input, so the Parameters view carries it until a result
 * arrives. (The native gallery always records a result.)
 */
const pending = (id, toolName, args, selector) => ({
  id: `${id}-pending`,
  toolName,
  arguments: args,
  content: null,
  selector,
  openArgs: true,
});

export const pendingTaskListSamples = [
  pending(
    "update-plan",
    "mcp__ccd_turn__update_plan",
    {
      items: [
        { content: "Review the fixture screenshots", status: "completed" },
        { content: "Compare the narrow viewport", status: "in_progress" },
        { content: "Record the findings", status: "pending" },
      ],
    },
    ".task-list",
  ),
  pending(
    "wrap-up",
    "mcp__ccd_turn__wrap_up",
    { recap: "The fixture screenshots are reviewed; nothing is committed." },
    ".task-wrapup",
  ),
  pending(
    "todo-write",
    "TodoWrite",
    { todos: [{ content: "Review the fixture screenshots", status: "in_progress" }] },
    ".task-list",
  ),
  pending(
    "task-create",
    "TaskCreate",
    { subject: "Record the findings", description: "Summarize the fixture review." },
    ".task-list",
  ),
  pending(
    "task-update",
    "TaskUpdate",
    { taskId: "2", status: "in_progress", addBlockedBy: ["1"] },
    ".task-changes",
  ),
];
