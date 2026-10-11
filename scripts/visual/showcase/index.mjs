// README showcase fixture: a coherent synthetic workspace (fictional `acme/*`
// repositories) used only by README captures. Unhandled commands fall through
// to the ordinary visual fixtures, then the typed client mocks.

import { showcaseAnalytics, showcaseCodeImpact, showcaseToolAnalysis } from "./analytics.mjs";
import { HERO_SESSION_ID } from "./common.mjs";
import { heroToolResult, heroTurns } from "./conversation.mjs";
import {
  heroCheckpoints,
  heroContextTimeline,
  heroFiles,
  heroIncidents,
  heroPlan,
  heroPromptCache,
  heroShutdownMetrics,
  heroTodos,
} from "./hero.mjs";
import { showcaseSearch, showcaseSkills, showcaseSkillUsage } from "./library.mjs";
import { showcaseOrchestration } from "./orchestration.mjs";
import { findSession, sessionDetail, sessionListItems } from "./sessions.mjs";

export const showcaseFixtureId = "readme-showcase";
export { SEARCH_QUERY } from "./library.mjs";
export { HERO_SESSION_ID };

const FILE_STAMP = {
  eventsFileSize: 2_318_402,
  eventsFileMtime: Date.parse("2026-09-30T14:18:45Z"),
};

const heroOnly = {
  get_session_turns: () => ({ turns: heroTurns, ...FILE_STAMP }),
  get_session_todos: () => heroTodos,
  get_session_plan: () => heroPlan,
  get_session_checkpoints: () => heroCheckpoints,
  get_session_incidents: () => heroIncidents,
  get_shutdown_metrics: () => heroShutdownMetrics,
  get_session_context_timeline: () => ({ timeline: heroContextTimeline, ...FILE_STAMP }),
  get_session_prompt_cache: () => ({ timeline: heroPromptCache, ...FILE_STAMP }),
  check_session_freshness: () => FILE_STAMP,
  session_list_files: (args) => ({
    root: `/home/demo/.copilot/session-state/${args.sessionId}`,
    entries: heroFiles,
  }),
  session_read_file: () => heroPlan.content,
};

const global = {
  list_sessions: () => sessionListItems(),
  search_sessions: () => sessionListItems(),
  get_session_detail: (args) => sessionDetail(args.sessionId, heroShutdownMetrics),
  get_analytics: showcaseAnalytics,
  get_tool_analysis: showcaseToolAnalysis,
  get_code_impact: showcaseCodeImpact,
  get_session_count: () => sessionListItems().length,
  get_session_liveness: (args) =>
    findSession(args.sessionId).isRunning
      ? { state: "running", pid: null, status: null }
      : { state: "idle" },
  get_tool_result: (args) => heroToolResult(args.toolCallId),
  skills_list_all: () => ({ skills: showcaseSkills, diagnostics: [] }),
  skills_usage_summary: () => showcaseSkillUsage,
  ...Object.fromEntries(Object.entries(showcaseSearch).map(([cmd, value]) => [cmd, () => value])),
  ...showcaseOrchestration,
};

/** Showcase data for `cmd`, or `undefined` to use the ordinary fixtures. */
export function showcaseFixture(cmd, args = {}, fixture) {
  if (fixture !== showcaseFixtureId) return undefined;
  if (Object.hasOwn(global, cmd)) return global[cmd](args);
  // Every session opens the hero's artifacts; README captures only open the hero.
  if (Object.hasOwn(heroOnly, cmd)) return heroOnly[cmd](args);
  return undefined;
}
