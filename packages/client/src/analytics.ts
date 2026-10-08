import type {
  AnalyticsData,
  CodeImpactData,
  SessionSource,
  ToolAnalysisData,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";

/** Get aggregated analytics data across sessions, optionally from one source. */
export async function getAnalytics(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
  /** Only sessions from this source; absent means every source. */
  source?: SessionSource;
}): Promise<AnalyticsData> {
  return invoke<AnalyticsData>("get_analytics", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
    source: options?.source,
  });
}

/** Get tool usage analysis data across sessions, optionally from one source. */
export async function getToolAnalysis(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
  /** Only sessions from this source; absent means every source. */
  source?: SessionSource;
}): Promise<ToolAnalysisData> {
  return invoke<ToolAnalysisData>("get_tool_analysis", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
    source: options?.source,
  });
}

/** Get code impact analysis data across sessions, optionally from one source. */
export async function getCodeImpact(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
  /** Only sessions from this source; absent means every source. */
  source?: SessionSource;
}): Promise<CodeImpactData> {
  return invoke<CodeImpactData>("get_code_impact", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
    source: options?.source,
  });
}
