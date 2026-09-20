/**
 * The Agents explorer's usage range. Shared with the Skills manager so both
 * pages mean the same thing by "30d" and send the index the same bounds.
 */
export type { UsageRange as AgentUsageRange } from "@/utils/usage/range";
export {
  rangeBounds,
  rangeDays,
  rangeStart,
  USAGE_RANGES as AGENT_USAGE_RANGES,
} from "@/utils/usage/range";
