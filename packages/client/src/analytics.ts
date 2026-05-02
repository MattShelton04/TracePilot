import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from "@tracepilot/types";

import { invoke } from "./internal/core.js";

/** Get aggregated analytics data across all sessions. */
export async function getAnalytics(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<AnalyticsData> {
  return invoke<AnalyticsData>("get_analytics", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
  });
}

/** Get tool usage analysis data across all sessions. */
export async function getToolAnalysis(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<ToolAnalysisData> {
  return invoke<ToolAnalysisData>("get_tool_analysis", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
  });
}

/** Get code impact analysis data across all sessions. */
export async function getCodeImpact(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<CodeImpactData> {
  return invoke<CodeImpactData>("get_code_impact", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
  });
}
