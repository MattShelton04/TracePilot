/**
 * Synthetic sessions linked to pull requests, for `pnpm app:start -Fixtures`.
 *
 * Output shapes follow what the CLIs record (docs/features/session-pull-requests-plan.md §2):
 * Copilot's `gh pr create` progress line with the address glued on, the merge
 * line, the `git push` new-branch hint (not a pull request), and Claude Code's
 * repeated `pr-link` records. Every repository, branch and number is invented.
 */

import { Transcript, text, toolUse } from "./claude-transcript.mjs";

export const copilotPullRequestSessionId = "72510000-0000-4000-8000-000000000005";
export const claudePullRequestSessionId = "c1a0de00-0000-4000-8000-00000000000d";

const copilotStart = "2026-03-21T09:00:00.000Z";
const done = (output) => `${output}\n<exited with exit code 0>`;

/** A Copilot session that pushes a branch, opens a pull request, merges an older one and reviews another. */
export function buildCopilotPullRequestSession() {
  const events = [];
  const add = (type, data) => {
    const index = events.length;
    const id = (i) => `72510000-0000-4005-8000-${String(i).padStart(12, "0")}`;
    events.push({
      id: id(index),
      parentId: index ? id(index - 1) : null,
      timestamp: new Date(Date.parse(copilotStart) + index * 20_000).toISOString(),
      type,
      data,
    });
  };
  const shell = (turnId, id, command, output) => {
    add("tool.execution_start", {
      turnId,
      toolCallId: id,
      toolName: "powershell",
      arguments: { command, description: command.split(" ").slice(0, 3).join(" ") },
    });
    add("tool.execution_complete", {
      turnId,
      toolCallId: id,
      success: true,
      result: { content: done(output) },
    });
  };
  add("session.start", {
    sessionId: copilotPullRequestSessionId,
    version: 3,
    producer: "tracepilot-synthetic",
    copilotVersion: "1.0.90",
    startTime: copilotStart,
    selectedModel: "gpt-4.1",
    context: {
      cwd: "C:/synthetic/orchard",
      repository: "example/orchard",
      branch: "main",
      hostType: "github",
      repositoryHost: "github.com",
    },
  });
  add("user.message", {
    turnId: "turn-0",
    content:
      "Fix the ripeness check, open a pull request, and merge https://github.com/example/orchard/pull/57 once its checks pass. All content is synthetic.",
  });
  add("assistant.turn_start", { turnId: "turn-0", model: "gpt-4.1" });
  shell(
    "turn-0",
    "pr-view",
    "gh pr view 57",
    "title:\tBump the irrigation schedule\nstate:\tOPEN\nurl:\thttps://github.com/example/orchard/pull/57",
  );
  add("assistant.message", {
    turnId: "turn-0",
    content: "Its checks pass. Merging it, then fixing the ripeness check on a branch.",
  });
  shell(
    "turn-0",
    "pr-merge",
    "gh pr merge 57 --squash --delete-branch",
    "✓ Squashed and merged pull request example/orchard#57 (Bump the irrigation schedule)\n✓ Deleted remote branch chore/irrigation",
  );
  shell(
    "turn-0",
    "push",
    "git push -u origin fix/ripeness-check",
    [
      "To https://github.com/example/orchard.git",
      " * [new branch]      fix/ripeness-check -> fix/ripeness-check",
      "remote: Create a pull request for 'fix/ripeness-check' on GitHub by visiting:",
      "remote:      https://github.com/example/orchard/pull/new/fix/ripeness-check",
    ].join("\n"),
  );
  shell(
    "turn-0",
    "pr-create",
    'gh pr create --title "Fix the ripeness check" --body "Synthetic fixture."',
    "⣾⣽Creating pull request for fix/ripeness-check into main in example/orchard⣻⢿https://github.com/example/orchard/pull/58",
  );
  add("assistant.message", {
    turnId: "turn-0",
    content: "Merged #57 and opened #58 for the ripeness fix.",
  });
  add("assistant.turn_end", { turnId: "turn-0" });
  return {
    id: copilotPullRequestSessionId,
    title: "SYNTHETIC · Ship the ripeness fix",
    events,
    branch: "fix/ripeness-check",
    expected: { pullRequests: [58, 57] },
  };
}

const claudeUsage = { input: 10, cacheRead: 100, cacheWrite: 20, output: 5 };

/** A Claude Code session that opens one pull request, then pushes to an existing one. */
export function buildClaudePullRequestSession() {
  const t = new Transcript({
    sessionId: claudePullRequestSessionId,
    cwd: "C:/synthetic/lantern",
    branch: "feat/dimmer",
    namespace: "0c1a000c",
    start: "2026-10-08T09:00:00.000Z",
  });
  const prLink = (number) => ({
    type: "pr-link",
    prNumber: number,
    prUrl: `https://github.com/example/lantern/pull/${number}`,
    prRepository: "example/lantern",
    timestamp: t.timestamp(),
  });
  t.prompt("Open a pull request for the dimmer, then push the review fix to #12.");
  t.call(
    "pr_create",
    [
      toolUse("toolu_pr_create", "Bash", {
        command:
          'git push -u origin feat/dimmer && gh pr create --title "Add a dimmer" --body "Synthetic."',
        description: "Push and open the pull request",
      }),
    ],
    claudeUsage,
    "tool_use",
  );
  t.bookkeeping(prLink(31));
  t.toolResult(
    "toolu_pr_create",
    "branch 'feat/dimmer' set up to track 'origin/feat/dimmer'.\nhttps://github.com/example/lantern/pull/31",
    {
      stdout:
        "branch 'feat/dimmer' set up to track 'origin/feat/dimmer'.\nhttps://github.com/example/lantern/pull/31",
      stderr: "",
      interrupted: false,
      isImage: false,
    },
  );
  t.call("pr_created", [text("Opened #31.")], claudeUsage, "end_turn");
  t.bookkeeping(prLink(31));
  t.prompt("Now push the review fix to the wick branch.");
  t.call(
    "pr_push",
    [
      toolUse("toolu_pr_push", "Bash", {
        command: "git push origin fix/wick-length",
        description: "Push the review fix",
      }),
    ],
    claudeUsage,
    "tool_use",
  );
  t.bookkeeping(prLink(12));
  t.toolResult(
    "toolu_pr_push",
    "To https://github.com/example/lantern.git\n   1a2b3c4..5d6e7f8  fix/wick-length -> fix/wick-length",
    {
      stdout: "",
      stderr:
        "To https://github.com/example/lantern.git\n   1a2b3c4..5d6e7f8  fix/wick-length -> fix/wick-length",
      interrupted: false,
      isImage: false,
    },
  );
  t.call("pr_pushed", [text("Pushed the fix to #12.")], claudeUsage, "end_turn");
  t.bookkeeping(prLink(12));
  t.costState(0.0004, { input: 40, cacheRead: 400, cacheWrite: 80, output: 20 });
  const title = "SYNTHETIC · Dimmer pull requests";
  t.bookkeeping({ type: "ai-title", aiTitle: title });
  return {
    id: t.sessionId,
    title,
    files: [{ path: `projects/C--synthetic-lantern/${t.sessionId}.jsonl`, content: t.toJsonl() }],
  };
}
