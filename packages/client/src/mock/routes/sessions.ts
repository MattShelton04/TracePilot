import type {
  ContextTimelineResponse,
  FreshnessResponse,
  PromptCacheResponse,
  PullRequestSessionLink,
  SessionSectionsInfo,
  TurnActivityResponse,
  TurnsResponse,
} from "@tracepilot/types";
import { mockFileVersion } from "../claudeArtifacts.js";
import { MOCK_EMPTY_REQUEST_LOG } from "../claudeRequestLog.js";
import { MOCK_EVENTS_MTIME } from "../common.js";
import { MOCK_CONTEXT_TIMELINE } from "../contextTimeline.js";
import { MOCK_PROMPT_CACHE } from "../promptCache.js";
import {
  getMockPullRequestRelatedCounts,
  getMockSessionPullRequests,
  mockPullRequestLinks,
} from "../pullRequests.js";
import {
  getMockSessionDetail,
  getMockSessionEvents,
  getMockSessionTodos,
  getMockSessionTurns,
  getMockShutdownMetrics,
  MOCK_CHECKPOINTS,
  MOCK_SESSIONS,
} from "../sessions.js";
import { type MockRoutes, mockSessionId } from "./route.js";

/** Commands from `sessions.ts`. */
export const SESSION_ROUTES: MockRoutes = {
  list_sessions: () => MOCK_SESSIONS,
  get_session_detail: (args) => getMockSessionDetail(mockSessionId(args)),
  get_session_incidents: () => [
    {
      eventType: "error",
      sourceEventType: "session.error",
      timestamp: "2025-01-15T10:30:00Z",
      severity: "error" as const,
      summary: "Rate limit exceeded (429)",
      detailJson: { statusCode: 429, errorCode: "rate_limit" },
    },
    {
      eventType: "compaction",
      sourceEventType: "session.compaction_complete",
      timestamp: "2025-01-15T11:00:00Z",
      severity: "info" as const,
      summary: "Compaction: 45000 → 12000 tokens",
      detailJson: { preCompactionTokens: 45000, postCompactionTokens: 12000 },
    },
  ],
  get_session_pull_requests: (args) => getMockSessionPullRequests(mockSessionId(args)),
  get_session_pull_request_related_counts: (args) =>
    getMockPullRequestRelatedCounts(mockSessionId(args)),
  get_pull_request_sessions: (args): PullRequestSessionLink[] =>
    mockPullRequestLinks({
      host: String(args.host ?? ""),
      owner: String(args.owner ?? ""),
      repo: String(args.repo ?? ""),
      number: Number(args.number),
    }).flatMap(({ sessionId, roles }) => {
      const session = MOCK_SESSIONS.find((s) => s.id === sessionId);
      if (!session) return [];
      const { summary, repository, source, updatedAt } = session;
      return [
        {
          sessionId,
          summary: summary ?? null,
          repository: repository ?? null,
          source: source ?? "copilot",
          updatedAt: updatedAt ?? null,
          roles,
        },
      ];
    }),
  get_session_turns: (args): TurnsResponse => ({
    turns: getMockSessionTurns(mockSessionId(args)),
    eventsFileSize: 1024,
    eventsFileMtime: Date.now(),
  }),
  get_session_turn_activity: (args): TurnActivityResponse => ({
    turnStarts: getMockSessionTurns(mockSessionId(args)).map((turn) =>
      turn.timestamp ? Date.parse(turn.timestamp) : null,
    ),
  }),
  get_session_context_timeline: (): ContextTimelineResponse => ({
    timeline: MOCK_CONTEXT_TIMELINE,
    eventsFileSize: 1024,
    eventsFileMtime: MOCK_EVENTS_MTIME,
  }),
  get_session_request_log: () => MOCK_EMPTY_REQUEST_LOG,
  check_session_freshness: (): FreshnessResponse => ({
    eventsFileSize: 1024,
    eventsFileMtime: MOCK_EVENTS_MTIME,
    sourceVersion: "mock-source-version",
  }),
  get_session_events: (args) => getMockSessionEvents(mockSessionId(args)),
  get_session_todos: (args) => getMockSessionTodos(mockSessionId(args)),
  get_session_checkpoints: () => MOCK_CHECKPOINTS,
  get_session_plan: () => ({ content: "# Mock Plan\n\n1. Task one\n2. Task two" }),
  get_session_file_history: () => [],
  get_session_file_version: (args) => mockFileVersion(args),
  get_shutdown_metrics: (args) => getMockShutdownMetrics(mockSessionId(args)),
  get_session_prompt_cache: (): PromptCacheResponse => ({
    timeline: MOCK_PROMPT_CACHE,
    eventsFileSize: 1024,
    eventsFileMtime: MOCK_EVENTS_MTIME,
  }),
  search_sessions: (args) => {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    if (!query) return MOCK_SESSIONS;
    return MOCK_SESSIONS.filter((s) =>
      [s.summary, s.repository, s.branch, s.id].some((f) => f?.toLowerCase().includes(query)),
    );
  },
  get_session_sections: (args): SessionSectionsInfo => ({
    sessionId: mockSessionId(args),
    hasConversation: true,
    hasEvents: true,
    hasTodos: true,
    hasPlan: true,
    hasCheckpoints: true,
    hasMetrics: true,
    hasIncidents: true,
    hasRewindSnapshots: false,
    hasCustomTables: false,
    eventCount: 240,
    turnCount: 8,
  }),
  get_tool_result: (args) => {
    const toolCallId = typeof args.toolCallId === "string" ? args.toolCallId : "";
    for (const turn of getMockSessionTurns(mockSessionId(args))) {
      const tc = turn.toolCalls?.find((t) => t.toolCallId === toolCallId);
      if (tc && tc.resultContent != null) return tc.resultContent;
    }
    return null;
  },
  resume_session_in_terminal: () => undefined,
};
