import type { ConversationTurn } from "@tracepilot/types";
import { ts } from "./common.js";

const AGENT_NOTE =
  '<task-notification>\n<task-id>a5c0ffee00000001</task-id>\n<tool-use-id>claude-agent</tool-use-id>\n<status>completed</status>\n<summary>Agent "Map the retry call sites" finished</summary>\n<result>Three call sites retry: `upload`, `sync` and `prune`.</result>\n<usage><subagent_tokens>48200</subagent_tokens><tool_uses>14</tool_uses><duration_ms>120000</duration_ms></usage>\n</task-notification>';
const SHELL_NOTE =
  '<task-notification>\n<task-id>bg_suite</task-id>\n<tool-use-id>claude-bash-bg</tool-use-id>\n<status>failed</status>\n<summary>Background command "Run the slow integration suite" failed (exit code 1)</summary>\n</task-notification>';
const MONITOR_NOTE =
  '<task-notification>\n<task-id>bg_watch</task-id>\n<tool-use-id>claude-bash-watch</tool-use-id>\n<summary>Monitor event: "cargo check"</summary>\n<event>Finished `dev` profile in 4.2s\n0 warnings</event>\n</task-notification>';

/**
 * Synthetic background completions that wake the idle session: one turn the
 * notifications open (as the Rust translator writes it) and the reply.
 */
export const MOCK_CLAUDE_NOTIFICATION_TURNS: ConversationTurn[] = [
  {
    turnIndex: 2,
    userMessage:
      'Agent "Map the retry call sites" finished · 48.2K tokens · 14 tool uses · 2m\nBackground command "Run the slow integration suite" failed (exit code 1)\nMonitor event: "cargo check" · Finished `dev` profile in 4.2s',
    transformedUserMessage: `${AGENT_NOTE}\n${SHELL_NOTE}\n${MONITOR_NOTE}`,
    systemInitiated: true,
    notifications: [
      {
        taskId: "a5c0ffee00000001",
        toolUseId: "claude-agent",
        kind: "agent",
        status: "completed",
        summary: 'Agent "Map the retry call sites" finished',
        result: "Three call sites retry: `upload`, `sync` and `prune`.",
        totalTokens: 48200,
        toolUses: 14,
        durationMs: 120000,
      },
      {
        taskId: "bg_suite",
        toolUseId: "claude-bash-bg",
        kind: "shell",
        status: "failed",
        summary: 'Background command "Run the slow integration suite" failed (exit code 1)',
        exitCode: 1,
      },
      {
        taskId: "bg_watch",
        toolUseId: "claude-bash-watch",
        kind: "monitor",
        summary: 'Monitor event: "cargo check"',
        event: "Finished `dev` profile in 4.2s\n0 warnings",
      },
    ],
    timestamp: ts(-300),
    assistantMessages: [
      { content: "The map is in; the slow suite failed, so I'll look at its output next." },
    ],
    model: "claude-opus-4-6",
    isComplete: true,
    toolCalls: [],
    usage: {
      inputTokens: 300,
      outputTokens: 12,
      cacheReadTokens: 240,
      cacheWriteTokens: 40,
      reasoningTokens: 0,
      modelCalls: 1,
    },
  },
];
