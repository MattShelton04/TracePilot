/**
 * LEGACY SHIM — prefer importing from `@tracepilot/ui`.
 *
 * Design token readers moved to `@tracepilot/ui` in wave 14 (phase 5.2).
 * This shim will be removed one release after 0.6.x. Migrate imports to:
 *
 *   import { getDesignToken, getChartColors } from "@tracepilot/ui";
 */
export {
  getAgentColors,
  getChartColors,
  getDesignToken,
  getSemanticColors,
  getStatusColors,
} from "@tracepilot/ui";
