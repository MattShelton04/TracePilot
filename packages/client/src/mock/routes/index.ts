/**
 * Mock answers for every command, used outside the Tauri webview. Each client
 * module's commands live in the matching file here; add a route there.
 */
import { claudeMockRoute } from "../claudeRoutes.js";
import { searchMockRoute } from "../search.js";
import { ANALYTICS_ROUTES } from "./analytics.js";
import { CONFIG_ROUTES } from "./config.js";
import { CONTEXT_CAPTURE_ROUTES } from "./contextCapture.js";
import { EXPORT_ROUTES } from "./export.js";
import { MAINT_ROUTES } from "./maint.js";
import type { MockArgs, MockRoutes } from "./route.js";
import { SEARCH_ROUTES } from "./search.js";
import { SESSION_ROUTES } from "./sessions.js";

/** Route tables by domain; a command appears in at most one (tested). */
export const MOCK_ROUTE_TABLES: Record<string, MockRoutes> = {
  analytics: ANALYTICS_ROUTES,
  config: CONFIG_ROUTES,
  contextCapture: CONTEXT_CAPTURE_ROUTES,
  export: EXPORT_ROUTES,
  maint: MAINT_ROUTES,
  search: SEARCH_ROUTES,
  sessions: SESSION_ROUTES,
};

const MOCK_ROUTES: MockRoutes = Object.assign({}, ...Object.values(MOCK_ROUTE_TABLES));

/**
 * The mock answer for `cmd`. Claude Code sessions and search queries have
 * their own routers, consulted first.
 */
export function mockRoute(cmd: string, args: MockArgs = {}): unknown {
  const claude = claudeMockRoute(cmd, args);
  if (claude) return claude.value;
  const search = searchMockRoute(cmd, args);
  if (search) return search.value;
  const route = Object.hasOwn(MOCK_ROUTES, cmd) ? MOCK_ROUTES[cmd] : undefined;
  if (!route) throw new Error(`[STUB] No mock data for command: ${cmd}`);
  return route(args);
}
