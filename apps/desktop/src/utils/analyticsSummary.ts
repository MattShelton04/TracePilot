/**
 * The Analytics dashboard's derived figures, computed once per payload and
 * shared by its panels: what each source cost, what the tokens were, and
 * each model's share and cost.
 *
 * Costs keep each source's own unit (AI Credits for Copilot, API-equivalent
 * USD for Claude Code) and meet on one USD scale only where sources are
 * added together, with AI Credits at $0.01 each.
 */
import {
  AI_CREDIT_USD,
  type AnalyticsData,
  formatAiCredits,
  formatCost,
  formatNumber,
  type SessionSource,
  sourceCapabilities,
  sourceLabel,
} from "@tracepilot/types";
import {
  type AnalyticsAiCreditSummary,
  buildAnalyticsAiCreditSummary,
  buildAnalyticsCostSeries,
  buildSourceCostRows,
  type CombinedCostTotal,
  combinedCostTotal,
  type SourceCostRow,
  usageAiCredits,
} from "@/utils/analyticsCostSeries";
import { payloadSources } from "@/utils/analyticsDashboard";
import { modelLabels } from "@/utils/modelLabels";

type ComputeTokenCost = (
  model: string,
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  cacheWriteTokens?: number,
) => number | null;

export interface Pricing {
  computeUsageBasedCost: ComputeTokenCost;
  computeWholesaleCost: ComputeTokenCost;
}

/** Model colours in token order; past the end every model shares the tail. */
export const MODEL_COLORS = [
  "var(--chart-primary)",
  "var(--chart-success)",
  "var(--chart-warning)",
  "var(--chart-danger)",
  "var(--chart-cyan)",
  "var(--chart-orange)",
  "var(--chart-secondary)",
  "var(--chart-lime)",
];
export const MODEL_TAIL = "var(--neutral-emphasis)";

export type CompositionKey = "cacheRead" | "cacheWrite" | "fresh" | "output";

/** The four kinds of token, in the order they stack. */
export const COMPOSITION: ReadonlyArray<{ key: CompositionKey; label: string; color: string }> = [
  { key: "cacheRead", label: "Cache reads", color: "var(--chart-primary)" },
  { key: "cacheWrite", label: "Cache writes", color: "var(--chart-secondary)" },
  { key: "fresh", label: "Fresh input", color: "var(--chart-cyan)" },
  { key: "output", label: "Output", color: "var(--chart-success)" },
];

export type TokenComposition = Record<CompositionKey, number> & { total: number; input: number };

/** Input counts cache reads and writes, so fresh input is what is left. */
export function composition(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens?: number;
}): TokenComposition {
  const cacheRead = usage.cacheReadTokens;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const output = usage.outputTokens;
  const input = cacheRead + cacheWrite + fresh;
  return { cacheRead, cacheWrite, fresh, output, input, total: input + output };
}

function addCompositions(parts: TokenComposition[]): TokenComposition {
  const sum = (key: keyof TokenComposition) => parts.reduce((total, part) => total + part[key], 0);
  return {
    cacheRead: sum("cacheRead"),
    cacheWrite: sum("cacheWrite"),
    fresh: sum("fresh"),
    output: sum("output"),
    input: sum("input"),
    total: sum("total"),
  };
}

export interface ModelRow {
  key: string;
  label: string;
  source: SessionSource;
  color: string;
  tokens: number;
  /** Share of every model's tokens, in percent. */
  share: number;
  requests: number;
  composition: TokenComposition;
  /** The model's cost in its source's unit, formatted; `—` when unpriced. */
  costText: string;
  /** The same cost in USD, for ranking across sources. */
  usd: number | null;
  partial: boolean;
}

export interface SourceCacheRow {
  source: SessionSource;
  /** Input served from cache, in percent. */
  hitRate: number;
  input: number;
}

export interface DashboardSummary {
  sources: SessionSource[];
  credits: AnalyticsAiCreditSummary;
  costRows: SourceCostRow[];
  /** Every source in USD; AI Credits at $0.01. */
  costTotal: CombinedCostTotal;
  /** Every source in range is billed in AI Credits, so cost reads in them. */
  inAiCredits: boolean;
  composition: TokenComposition;
  models: ModelRow[];
  cacheBySource: SourceCacheRow[];
  aiCreditsByDay: Map<string, number>;
}

/** Payloads from before sources were recorded are Copilot's alone. */
function withSources(data: AnalyticsData): AnalyticsData {
  if (data.costBySource) return data;
  return {
    ...data,
    costBySource: data.totalSessions
      ? [
          {
            source: "copilot",
            sessions: data.totalSessions,
            tokens: data.totalTokens,
            costUsd: null,
            sessionsWithCostUsd: 0,
          },
        ]
      : [],
  };
}

export function buildDashboardSummary(payload: AnalyticsData, pricing: Pricing): DashboardSummary {
  const data = withSources(payload);
  const sources = payloadSources(data);
  const credits = buildAnalyticsAiCreditSummary(
    data,
    pricing.computeUsageBasedCost,
    pricing.computeWholesaleCost,
  );
  const costRows = buildSourceCostRows(data, credits);
  const labels = modelLabels(data.modelDistribution);
  const totalTokens = data.modelDistribution.reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens,
    0,
  );

  const models = data.modelDistribution
    .map((m, i) => {
      const source = m.source ?? "copilot";
      const parts = composition(m);
      let costText = "—";
      let usd: number | null = null;
      if (sourceCapabilities(source).hasAic) {
        const aic = usageAiCredits(m, pricing.computeUsageBasedCost, pricing.computeWholesaleCost);
        if (aic != null) {
          costText = formatAiCredits(aic);
          usd = aic * AI_CREDIT_USD;
        }
      } else if (m.costUsd != null) {
        costText = formatCost(m.costUsd);
        usd = m.costUsd;
      }
      return {
        key: `${source}:${m.model}`,
        label: labels[i].label,
        source,
        color: "",
        tokens: parts.total,
        share: totalTokens > 0 ? (parts.total / totalTokens) * 100 : 0,
        requests: m.requestCount,
        composition: parts,
        costText,
        usd,
        partial: Boolean(m.costUsdPartial),
      };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .map((row, i) => ({ ...row, color: MODEL_COLORS[i] ?? MODEL_TAIL }));

  const cacheBySource = sources
    .map((source) => {
      const parts = addCompositions(
        models.filter((m) => m.source === source).map((m) => m.composition),
      );
      return {
        source,
        hitRate: parts.input > 0 ? (parts.cacheRead / parts.input) * 100 : 0,
        input: parts.input,
      };
    })
    .filter((row) => row.input > 0);

  const aiCreditsByDay = new Map(
    buildAnalyticsCostSeries(
      data,
      "aiCredits",
      0,
      pricing.computeWholesaleCost,
      pricing.computeUsageBasedCost,
    ).map((point) => [point.date, point.cost]),
  );

  return {
    sources,
    credits,
    costRows,
    costTotal: combinedCostTotal(costRows),
    inAiCredits: sources.length > 0 && sources.every((s) => sourceCapabilities(s).hasAic),
    composition: addCompositions(models.map((m) => m.composition)),
    models,
    cacheBySource,
    aiCreditsByDay,
  };
}

/** Cost in the dashboard's unit: AI Credits when only they are in range. */
export function formatDashboardCost(value: number, inAiCredits: boolean): string {
  if (inAiCredits) return formatAiCredits(value);
  if (value >= 10_000) return `$${formatNumber(value)}`;
  if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
  return formatCost(value);
}

/** Axis labels: whole units, compact past a thousand. */
export function formatAxisCost(value: number, inAiCredits: boolean): string {
  if (inAiCredits) return value >= 1_000 ? formatNumber(value) : `${Math.round(value * 10) / 10}`;
  if (value >= 1_000) return `$${formatNumber(value)}`;
  return value >= 10 || value === 0 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`;
}

/** `Copilot $0.13 + Claude Code $1.25`, for the combined cost's tooltip. */
export function costBreakdown(rows: readonly SourceCostRow[]): string {
  return rows
    .map(
      (row) =>
        `${sourceLabel(row.source)} ${row.usdEquivalent == null ? "unpriced" : formatCost(row.usdEquivalent)}`,
    )
    .join(" + ");
}

export function aiCreditBasis(summary: AnalyticsAiCreditSummary | null): string {
  if (!summary) return "";
  const partial = summary.isPartial ? " Partial total: some models could not be priced." : "";
  if (summary.source === "observed") return `Observed Copilot billing telemetry.${partial}`;
  if (summary.source === "mixed-observed-estimated") {
    return `Observed AIC merged with estimates for historical sessions.${partial}`;
  }
  if (summary.source === "estimated-token-usage") {
    return `Estimated from GitHub token rates.${partial}`;
  }
  if (summary.source === "estimated-direct-api")
    return `Estimated from direct API rates.${partial}`;
  return "No AIC or compatible token pricing data";
}
