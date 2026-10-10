import type { ContextTimelineResponse, PromptCacheResponse } from "@tracepilot/types";
import { MOCK_CLAUDE_ANALYTICS, MOCK_CLAUDE_TOOL_ANALYSIS } from "./claudeAnalytics.js";
import { MOCK_CLAUDE_FILE_HISTORY, MOCK_CLAUDE_PLAN } from "./claudeArtifacts.js";
import { MOCK_CLAUDE_CONTEXT_TIMELINE, MOCK_CLAUDE_PROMPT_CACHE } from "./claudeContext.js";
import { MOCK_CLAUDE_BACKGROUND_TASKS } from "./claudeSessions.js";
import { MOCK_EVENTS_MTIME } from "./common.js";
import { MOCK_CLAUDE_FORMAT_DIAGNOSTICS } from "./formatDiagnostics.js";
import { isMockClaudeSession } from "./sessions.js";

/**
 * Per-session commands whose Claude Code answer differs from Copilot's: Claude
 * records context totals only, has no checkpoint summaries, approves plans via
 * `ExitPlanMode`, and keeps file history and background agents.
 */
const CLAUDE_SESSION_ROUTES: Record<string, unknown> = {
  get_session_context_timeline: {
    timeline: MOCK_CLAUDE_CONTEXT_TIMELINE,
    eventsFileSize: 1024,
    eventsFileMtime: MOCK_EVENTS_MTIME,
  } as ContextTimelineResponse,
  get_session_checkpoints: [],
  get_session_plan: MOCK_CLAUDE_PLAN,
  get_session_file_history: MOCK_CLAUDE_FILE_HISTORY,
  get_session_background_tasks: MOCK_CLAUDE_BACKGROUND_TASKS,
  get_session_prompt_cache: {
    timeline: MOCK_CLAUDE_PROMPT_CACHE,
    eventsFileSize: 1024,
    eventsFileMtime: MOCK_EVENTS_MTIME,
  } as PromptCacheResponse,
};

/** Cross-session commands filtered with `source: "claudeCode"`. */
const CLAUDE_SOURCE_ROUTES: Record<string, unknown> = {
  get_analytics: MOCK_CLAUDE_ANALYTICS,
  get_tool_analysis: MOCK_CLAUDE_TOOL_ANALYSIS,
  get_source_format_diagnostics: MOCK_CLAUDE_FORMAT_DIAGNOSTICS,
};

/**
 * Claude Code answer for a mock command, consulted before the shared router in
 * `internal/mockData.ts`. Returns `undefined` when the command has no
 * Claude-specific answer for these args, so the shared mock applies.
 */
export function claudeMockRoute(
  cmd: string,
  args?: Record<string, unknown>,
): { value: unknown } | undefined {
  if (args?.source === "claudeCode" && cmd in CLAUDE_SOURCE_ROUTES) {
    return { value: CLAUDE_SOURCE_ROUTES[cmd] };
  }
  const sessionId = typeof args?.sessionId === "string" ? args.sessionId : "";
  if (cmd in CLAUDE_SESSION_ROUTES && isMockClaudeSession(sessionId)) {
    return { value: CLAUDE_SESSION_ROUTES[cmd] };
  }
  return undefined;
}
