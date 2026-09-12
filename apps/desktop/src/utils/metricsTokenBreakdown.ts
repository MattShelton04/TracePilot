import type { ModelMetricDetail } from "@tracepilot/types";

export interface MetricsTokenBreakdown {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  uncached: number | null;
  /** Everything not served from cache, including cache creation. */
  notCached: number | null;
  reasoning: number | null;
  total: number | null;
  cacheRatio: number | null;
  inconsistent: boolean;
}

function numeric(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Cache counts partition input; reasoning is a detail within output. */
export function modelTokenBreakdown(model: ModelMetricDetail): MetricsTokenBreakdown {
  const usage = model.usage;
  const input = numeric(usage?.inputTokens);
  const output = numeric(usage?.outputTokens);
  const cacheRead =
    numeric(usage?.cacheReadTokens) ?? numeric(model.tokenDetails?.cache_read?.tokenCount);
  const cacheWrite =
    numeric(usage?.cacheWriteTokens) ?? numeric(model.tokenDetails?.cache_write?.tokenCount);
  const derivedUncached =
    input != null && cacheRead != null && cacheWrite != null
      ? input - cacheRead - cacheWrite
      : null;
  const uncached = numeric(model.tokenDetails?.input?.tokenCount) ?? numeric(derivedUncached);
  const reasoning = numeric(usage?.reasoningTokens);
  const inconsistent =
    (derivedUncached != null && derivedUncached < 0) ||
    (input != null && cacheRead != null && cacheRead > input) ||
    (input != null &&
      cacheRead != null &&
      cacheWrite != null &&
      uncached != null &&
      input !== cacheRead + cacheWrite + uncached) ||
    (output != null && reasoning != null && reasoning > output);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    uncached,
    notCached: input != null && cacheRead != null ? numeric(input - cacheRead) : null,
    reasoning,
    total: input != null && output != null ? input + output : null,
    cacheRatio:
      input != null && input > 0 && cacheRead != null && cacheRead <= input
        ? cacheRead / input
        : null,
    inconsistent,
  };
}

/** A missing category in any model makes that category's session total unknown. */
export function combinedTokenBreakdown(models: ModelMetricDetail[]): MetricsTokenBreakdown {
  const rows = models.map(modelTokenBreakdown);
  const sum = (
    key:
      | "input"
      | "output"
      | "cacheRead"
      | "cacheWrite"
      | "uncached"
      | "notCached"
      | "reasoning"
      | "total",
  ) =>
    rows.length > 0 && rows.every((row) => row[key] != null)
      ? rows.reduce((n, row) => n + (row[key] ?? 0), 0)
      : null;
  const input = sum("input");
  const cacheRead = sum("cacheRead");
  return {
    input,
    output: sum("output"),
    cacheRead,
    cacheWrite: sum("cacheWrite"),
    uncached: sum("uncached"),
    notCached: sum("notCached"),
    reasoning: sum("reasoning"),
    total: sum("total"),
    cacheRatio:
      input != null && input > 0 && cacheRead != null && cacheRead <= input
        ? cacheRead / input
        : null,
    inconsistent: rows.some((row) => row.inconsistent),
  };
}
