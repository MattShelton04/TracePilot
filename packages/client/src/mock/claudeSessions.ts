import type { ConversationTurn, EventsResponse } from "@tracepilot/types";
import { MOCK_CLAUDE_NOTIFICATION_TURNS } from "./claudeNotifications.js";
import { ts } from "./common.js";

/** Claude-specific conversation data; never reuse Copilot turns in source demos. */
export const MOCK_CLAUDE_TURNS: ConversationTurn[] = [
  {
    turnIndex: 0,
    userMessage: "Review indexing retries.",
    assistantMessages: [{ content: "I'll inspect the retry policy and run its tests." }],
    model: "claude-opus-4-6",
    isComplete: true,
    usage: {
      inputTokens: 130,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      reasoningTokens: 0,
      modelCalls: 1,
    },
    toolCalls: [
      {
        toolCallId: "claude-read",
        toolName: "view",
        nativeToolName: "Read",
        arguments: { path: "src/retry.rs", view_range: [1, 2] },
        resultContent: "1. pub const MAX_RETRIES: u32 = 3;\n2. pub const RETRY_MS: u64 = 200;",
        startedAt: ts(-600),
        completedAt: ts(-590),
        durationMs: 10000,
        isComplete: true,
        success: true,
      },
      {
        toolCallId: "claude-bash",
        toolName: "shell",
        nativeToolName: "Bash",
        arguments: { command: "cargo test retry", description: "Check retry policy" },
        resultContent: "test retry_policy ... ok",
        exitCode: 0,
        startedAt: ts(-589),
        completedAt: ts(-580),
        durationMs: 9000,
        isComplete: true,
        success: true,
      },
      {
        toolCallId: "claude-agent",
        toolName: "task",
        nativeToolName: "Agent",
        arguments: { subagent_type: "Explore", description: "Map the retry call sites" },
        resultContent: "Async agent launched successfully.",
        startedAt: ts(-579),
        completedAt: ts(-578),
        durationMs: 1000,
        isComplete: true,
        success: true,
      },
      {
        toolCallId: "claude-bash-bg",
        toolName: "shell",
        nativeToolName: "Bash",
        arguments: {
          command: "cargo test --test slow",
          description: "Run the slow integration suite",
          mode: "background",
          shellId: "bg_suite",
        },
        resultContent: "Command running in background with ID: bg_suite",
        startedAt: ts(-577),
        completedAt: ts(-576),
        durationMs: 1000,
        isComplete: true,
        success: true,
        // Reported later by its task notification.
        backgroundOutcome: { status: "failed", exitCode: 1, completedAt: ts(271_423) },
      },
    ],
  },
  {
    turnIndex: 1,
    assistantMessages: [{ content: "The retry policy uses bounded retries and passes its tests." }],
    model: "claude-opus-4-6",
    isComplete: true,
    toolCalls: [],
    usage: {
      inputTokens: 260,
      outputTokens: 8,
      cacheReadTokens: 200,
      cacheWriteTokens: 40,
      reasoningTokens: 0,
      modelCalls: 1,
    },
  },
  ...MOCK_CLAUDE_NOTIFICATION_TURNS,
];

export const MOCK_CLAUDE_EVENTS: EventsResponse = {
  events: [
    {
      id: "claude-prompt",
      eventType: "user.message",
      timestamp: ts(-61000),
      data: { content: "Review indexing retries." },
    },
    {
      id: "claude-read-start",
      eventType: "tool.execution_start",
      timestamp: ts(-60000),
      data: {
        toolCallId: "claude-read",
        toolName: "view",
        nativeToolName: "Read",
        arguments: { path: "src/retry.rs" },
      },
    },
    {
      id: "claude-model-call",
      eventType: "tracepilot.model_call",
      timestamp: ts(-58000),
      data: {
        model: "claude-opus-4-6",
        inputTokens: 130,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
        cacheWriteByTtl: { "3600": 20 },
        outputTokens: 5,
      },
    },
  ],
  totalCount: 3,
  hasMore: false,
  allEventTypes: ["user.message", "tool.execution_start", "tracepilot.model_call"],
};
