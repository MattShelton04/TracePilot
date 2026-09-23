/**
 * Presentation helpers for observed request performance.
 *
 * Everything here exists to stop four different questions being read as one
 * answer. Each latency metric is measured over the rows that recorded *it*,
 * so the four populations differ and their medians do not compare with each
 * other; a suppressed p95 is a display threshold rather than an absent
 * figure; and "did the cache help?" has a request-weighted answer and a
 * token-weighted answer that routinely disagree.
 */

import type {
  CacheReuse,
  FieldCoverage,
  LatencyDistribution,
  RequestPerformance,
} from "@tracepilot/types";
import { formatCleanFloat, formatNumberFull } from "@tracepilot/types";
import { millisecondCell, NOT_RECORDED } from "./requestLedger";

/** Said once per section: the comparison is observational, not a benchmark. */
export const OBSERVATIONAL_NOTE =
  "These are observations of recorded API calls, not controlled benchmarks or a quality ranking. " +
  "Prompt sizes and agent roles vary between models.";

/** Said once per section: the four metrics do not share a population. */
export const POPULATION_NOTE =
  "Median and p95 use each metric's own recorded samples. Coverage is shown below each value.";

/** Shown in place of a p95 that the backend withheld. */
export const P95_SUPPRESSED = "Not enough samples";

/** Shown when a metric had no usable rows at all. */
export const NO_SAMPLES = "No samples";

export type LatencyMetricKey =
  | "durationMs"
  | "timeToFirstTokenMs"
  | "outputTtftMs"
  | "interTokenLatencyMs";

interface LatencyMetricMeta {
  key: LatencyMetricKey;
  label: string;
  /** Why this metric is not the thing a reader might assume it is. */
  note: string;
}

/**
 * `outputTtftMs` is first *observable* output, so it counts reasoning and
 * tool-call output. Its gap from `timeToFirstTokenMs` is therefore not a
 * reasoning duration and is never presented as one.
 */
export const LATENCY_METRICS: readonly LatencyMetricMeta[] = [
  {
    key: "durationMs",
    label: "API duration",
    note: "The whole API call. It excludes tool runtime that happened outside the call.",
  },
  {
    key: "timeToFirstTokenMs",
    label: "Time to first token",
    note: "Recorded time to the first token of the response.",
  },
  {
    key: "outputTtftMs",
    label: "First observable output",
    note:
      "Includes reasoning and tool-call output, so it is not time to the first " +
      "user-visible answer. Its difference from time to first token is not reasoning time.",
  },
  {
    key: "interTokenLatencyMs",
    label: "Inter-token latency",
    note: "The average the source recorded. Its reciprocal is not a visible-token rate.",
  },
];

/** Why a p95 is absent: below the display threshold, or nothing to measure. */
export type P95Absence = "belowThreshold" | "noSamples" | null;

/**
 * A `null` p95 over a non-empty population is the backend's presentation
 * threshold, not a missing measurement — the median beside it is still real.
 */
export function p95Absence(distribution: LatencyDistribution): P95Absence {
  if (distribution.p95 != null) return null;
  return distribution.coverage.valid > 0 ? "belowThreshold" : "noSamples";
}

export function coverageText(coverage: FieldCoverage): string {
  const parts = [`${formatNumberFull(coverage.valid)} valid`];
  if (coverage.missing > 0) parts.push(`${formatNumberFull(coverage.missing)} not recorded`);
  if (coverage.invalid > 0) parts.push(`${formatNumberFull(coverage.invalid)} invalid`);
  return parts.join(" · ");
}

export interface LatencyMetricView {
  key: LatencyMetricKey;
  label: string;
  note: string;
  median: string;
  /** The median itself, for sorting; `null` when nothing was recorded. */
  medianMs: number | null;
  p95: string;
  /** Set when `p95` is a reason rather than a figure. */
  p95Absence: P95Absence;
  coverage: FieldCoverage;
  coverageText: string;
}

function latencyText(value: number | null): string {
  return value == null ? NOT_RECORDED : millisecondCell(value).text;
}

export function buildLatencyMetric(
  meta: LatencyMetricMeta,
  distribution: LatencyDistribution,
): LatencyMetricView {
  const absence = p95Absence(distribution);
  return {
    key: meta.key,
    label: meta.label,
    note: meta.note,
    median: latencyText(distribution.median),
    medianMs: distribution.median,
    p95: absence === null ? latencyText(distribution.p95) : absenceText(absence),
    p95Absence: absence,
    coverage: distribution.coverage,
    coverageText: coverageText(distribution.coverage),
  };
}

function absenceText(absence: Exclude<P95Absence, null>): string {
  return absence === "belowThreshold" ? P95_SUPPRESSED : NO_SAMPLES;
}

export function buildLatencyMetrics(performance: RequestPerformance): LatencyMetricView[] {
  return LATENCY_METRICS.map((meta) => buildLatencyMetric(meta, performance[meta.key]));
}

function percent(ratio: number | null): string {
  return ratio == null ? NOT_RECORDED : `${formatCleanFloat(ratio * 100, 1)}%`;
}

export interface CacheReuseFigure {
  label: string;
  value: string;
  /** The share itself, for sorting; `null` when it cannot be computed. */
  ratio: number | null;
  detail: string;
}

export interface CacheReuseView {
  /** Share of counter-recording requests that recorded any reuse at all. */
  requestWeighted: CacheReuseFigure;
  /** Share of input tokens that were cache reads. */
  tokenWeighted: CacheReuseFigure;
  /** Rows whose counters exceeded their input; excluded rather than clamped. */
  inconsistentRows: number;
  inconsistentNote: string | null;
}

/**
 * The two cache-reuse answers, kept apart on purpose. A run of tiny requests
 * that each reused a little and one huge request that reused nothing give a
 * high request-weighted figure and a low token-weighted one; neither is the
 * other's summary.
 */
export function buildCacheReuse(cache: CacheReuse): CacheReuseView {
  const requestRatio =
    cache.requestsWithCounter > 0 ? cache.requestsReportingReuse / cache.requestsWithCounter : null;
  return {
    requestWeighted: {
      label: "Requests recording any reuse",
      value: percent(requestRatio),
      ratio: requestRatio,
      detail:
        `${formatNumberFull(cache.requestsReportingReuse)} of ` +
        `${formatNumberFull(cache.requestsWithCounter)} requests with usable input and cache-read ` +
        "counters recorded at least one cache read. Missing or inconsistent counters are in neither population.",
    },
    tokenWeighted: {
      label: "Cache reads as a share of input tokens",
      value: percent(cache.tokenWeightedRatio),
      ratio: cache.tokenWeightedRatio,
      detail:
        `${formatNumberFull(cache.cacheReadTokens)} cache-read tokens over ` +
        `${formatNumberFull(cache.inputTokens)} input tokens. This weights every token ` +
        "equally, so it answers a different question from the request-weighted figure.",
    },
    inconsistentRows: cache.inconsistentRows,
    inconsistentNote:
      cache.inconsistentRows > 0
        ? `${formatNumberFull(cache.inconsistentRows)} request(s) recorded more cache reads ` +
          "than input tokens and are excluded from these figures rather than clamped."
        : null,
  };
}

export interface PerformanceRowView {
  /** `null` for the all-models row. */
  model: string | null;
  label: string;
  requestCount: number;
  sessionCount: number;
  metrics: LatencyMetricView[];
  cache: CacheReuseView;
}

export function buildPerformanceRow(
  model: string | null,
  label: string,
  performance: RequestPerformance,
): PerformanceRowView {
  return {
    model,
    label,
    requestCount: performance.requestCount,
    sessionCount: performance.sessionCount,
    metrics: buildLatencyMetrics(performance),
    cache: buildCacheReuse(performance.cache),
  };
}
