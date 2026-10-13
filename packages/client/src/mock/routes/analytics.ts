import { MOCK_ANALYTICS, MOCK_CODE_IMPACT, MOCK_TOOL_ANALYSIS } from "../analytics.js";
import type { MockRoutes } from "./route.js";

/** Commands from `analytics.ts`; Claude Code filters route in `claudeRoutes.ts`. */
export const ANALYTICS_ROUTES: MockRoutes = {
  get_analytics: () => MOCK_ANALYTICS,
  get_tool_analysis: () => MOCK_TOOL_ANALYSIS,
  get_code_impact: () => MOCK_CODE_IMPACT,
};
