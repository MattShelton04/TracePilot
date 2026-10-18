/**
 * The Metrics tab's cost, in one shape for every source: the headline figure
 * and its basis, and how it splits by token kind and by model.
 *
 * Copilot bills in AI Credits ($0.01 each), recorded per model at shutdown
 * or estimated from GitHub's token rates. Other sources carry a USD estimate
 * for the whole session only, so their per-model figures are its split at
 * API rates.
 */
import {
  AI_CREDIT_USD,
  type AiCreditUsage,
  calculateClaudeCodeTokenCost,
  type SessionSource,
  type ShutdownMetrics,
} from "@tracepilot/types";
import { formatAiCredits, formatAiCreditsUsd } from "@tracepilot/ui";
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from "vue";
import type { MetricsModelEntry } from "@/composables/useMetricsTabData";
import { usageCheckpointCredits } from "@/composables/useSessionMetrics";
import type { usePreferencesStore } from "@/stores/preferences";
import { type CostSplit, costSplit } from "@/utils/metricsView";
import {
  formatSessionCost,
  formatUsd,
  isCostLowerBound,
  sessionCostEstimate,
} from "@/utils/sourceCost";

export interface MetricsCostSummary {
  /** The headline figure, e.g. `$54.83` or `≥ $71.87`; `—` when unknown. */
  value: string;
  /** USD behind `value`; null when unpriced. */
  usd: number | null;
  /** AI Credits, for sources billed in them. */
  credits: string | null;
  /** Where the figure comes from: `Observed`, `Claude Code estimate`. */
  basis: string;
  /** False for a figure recorded by the provider. */
  estimate: boolean;
  partial: boolean;
  lowerBound: boolean;
  /** What the figure covers, in a sentence. */
  coverage: string;
  /**
   * AI Credits in a usage checkpoint's total that no model row covers yet,
   * e.g. `0.416 AIC since the last shutdown`; null when none are.
   */
  unattributed: string | null;
}

function creditBasis(usage: AiCreditUsage): string {
  if (usage.source === "observed") return "Observed";
  if (usage.source === "unavailable") return "Not recorded";
  return "Estimated";
}

function creditCoverage(usage: AiCreditUsage, metrics: ShutdownMetrics): string {
  // A running session's totals come from its latest usage checkpoint.
  const checkpoint = usage.source === "observed" ? usageCheckpointCredits(metrics) : null;
  if (checkpoint) {
    return `Recorded by Copilot CLI at its latest usage checkpoint (${new Date(checkpoint.timestamp).toLocaleString()}), written when the agent last went idle. Model rows cover completed runs only. AI Credits count at $0.01.`;
  }
  const at = metrics.metricsTimestamp
    ? ` at the last shutdown (${new Date(metrics.metricsTimestamp).toLocaleString()})`
    : "";
  if (usage.source === "observed")
    return `Recorded by Copilot CLI${at}. AI Credits count at $0.01.`;
  if (usage.source === "estimated-token-usage") {
    return `This CLI version doesn't record AI Credits, so the cost is estimated from token counts at GitHub's rates${at}.`;
  }
  if (usage.source === "estimated-direct-api") {
    return "Estimated from token counts at direct API rates; GitHub rates were unavailable.";
  }
  return "No cost was recorded for this session.";
}

function unattributedCredits(usage: AiCreditUsage, metrics: ShutdownMetrics): string | null {
  if (usage.source !== "observed") return null;
  const credits = usageCheckpointCredits(metrics)?.unattributedCredits;
  if (credits == null) return null;
  return `${formatAiCredits(credits)}${metrics.sessionSegments?.length ? " since the last shutdown" : ""}`;
}

export function useMetricsCost(options: {
  metrics: ComputedRef<ShutdownMetrics | null | undefined>;
  source: MaybeRefOrGetter<SessionSource>;
  /** True for sources billed in AI Credits. */
  credits: MaybeRefOrGetter<boolean>;
  aiCreditUsage: ComputedRef<AiCreditUsage>;
  modelEntries: ComputedRef<MetricsModelEntry[]>;
  prefs: ReturnType<typeof usePreferencesStore>;
}) {
  const { metrics, aiCreditUsage, modelEntries, prefs } = options;

  const summary = computed<MetricsCostSummary | null>(() => {
    const m = metrics.value;
    if (!m) return null;
    if (toValue(options.credits)) {
      const usage = aiCreditUsage.value;
      return {
        value: formatAiCreditsUsd(usage.credits),
        usd: usage.credits == null ? null : usage.credits * AI_CREDIT_USD,
        credits: usage.credits == null ? null : formatAiCredits(usage.credits),
        basis: creditBasis(usage),
        estimate: usage.source !== "observed",
        partial: false,
        lowerBound: false,
        coverage: creditCoverage(usage, m),
        unattributed: unattributedCredits(usage, m),
      };
    }
    const estimate = sessionCostEstimate(toValue(options.source), m);
    return {
      value: formatSessionCost(estimate),
      usd: estimate.amount ?? estimate.snapshotAmount,
      credits: null,
      basis: estimate.basisLabel,
      estimate: estimate.basis !== "billed",
      partial: estimate.partial,
      lowerBound: isCostLowerBound(estimate),
      coverage: estimate.coverage,
      unattributed: null,
    };
  });

  /** Shares at list prices: GitHub's rates for AI Credits, API rates otherwise. */
  const split = computed<CostSplit | null>(() => {
    const models = metrics.value?.modelMetrics;
    if (!models) return null;
    if (toValue(options.credits)) {
      return costSplit(models, (name, usage) =>
        prefs.computeUsageBasedCostBreakdown(
          name,
          usage.inputTokens ?? 0,
          usage.cacheReadTokens ?? 0,
          usage.outputTokens ?? 0,
          usage.cacheWriteTokens ?? 0,
        ),
      );
    }
    return costSplit(models, (name, usage) => calculateClaudeCodeTokenCost(name, usage));
  });

  /** A model's cost in USD: its recorded AI Credits, or its share of the total. */
  function modelUsd(name: string): number | null {
    if (toValue(options.credits)) {
      const credits = modelEntries.value.find((entry) => entry.name === name)?.aiCredits;
      return credits == null ? null : credits * AI_CREDIT_USD;
    }
    const share = split.value?.byModel[name];
    const total = summary.value?.usd;
    return share == null || total == null ? null : share * total;
  }

  /** A model's cost, formatted; `—` when unknown. */
  function formatModelCost(name: string): string {
    const usd = modelUsd(name);
    return usd == null ? "—" : formatUsd(usd);
  }

  return { summary, split, modelUsd, formatModelCost };
}
