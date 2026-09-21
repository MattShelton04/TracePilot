/**
 * Pairing a prompt-cache prediction with what the resuming request recorded.
 *
 * The prediction and the observation answer different questions, so neither
 * rewrites the other: an "Expired" window stays expired even when the request
 * that resumed it recorded cache reads, because the prefix may have been
 * rebuilt or only partly survived. Copy rules follow from that —
 *   - agreement is consistency, never proof;
 *   - a disagreement is worth reading, not worth hiding;
 *   - an absent counter is "not recorded", never "no reuse";
 *   - no cost difference is ever called actual savings, because a no-miss
 *     counterfactual still needs assumptions.
 */

import type { CacheObservation, CacheWindow } from "@tracepilot/types";
import { formatNumberFull, formatTime } from "@tracepilot/types";
import { OUTCOME_LABELS, type WindowDetailRow } from "./promptCache";

export type ObservationTone = "neutral" | "warning";

export interface ObservationView {
  windowIndex: number;
  /** One sentence pairing the prediction with the recorded counters. */
  pairing: string;
  comparisonLabel: string;
  comparisonNote: string;
  tone: ObservationTone;
  /** Rows appended to the window's detail list. */
  rows: WindowDetailRow[];
}

/**
 * Index observations by the window they belong to. A window with no entry is
 * the normal case: it means no reliable association was found, which is not
 * the same as a window whose resume reused nothing.
 */
export function observationsByWindow(
  observations: readonly CacheObservation[],
): Map<number, CacheObservation> {
  const map = new Map<number, CacheObservation>();
  for (const observation of observations) {
    if (!map.has(observation.windowIndex)) map.set(observation.windowIndex, observation);
  }
  return map;
}

/** How the counters read, keeping an absent counter apart from a zero. */
function describeReads(observation: CacheObservation): string {
  if (observation.cacheReadTokens == null) return "recorded no cache-read counter";
  if (observation.cacheReadTokens === 0) return "recorded no cache reads";
  return `recorded ${formatNumberFull(observation.cacheReadTokens)} cache reads`;
}

const COMPARISON_LABELS = {
  agrees: "Consistent",
  differs: "Disagrees",
  notComparable: "Not comparable",
} as const;

function comparisonNote(observation: CacheObservation): string {
  switch (observation.comparison) {
    case "agrees":
      return observation.cacheReadTokens === 0
        ? "Consistent, not proven: zero recorded cache reads support “no reuse was recorded”, " +
            "never “the whole prefix had expired”."
        : "Consistent with the prediction, not proof of it. The counters describe this one " +
            "request, not the fate of the whole prefix.";
    case "differs":
      return (
        "The recorded request disagrees with the prediction, which usually says more than " +
        "either figure alone: the prefix may have been rebuilt, or only part of it may have " +
        "survived. The prediction above is left as it was recorded."
      );
    default:
      return "The recorded request does not answer the same question as this prediction.";
  }
}

/** How the pair was associated. Never `exact`: no identifier links the two. */
const ATTRIBUTION_NOTES = {
  exact: "Matched by identity.",
  validated: "Matched on order, interval and model, not by a shared identifier.",
  ambiguous: "The match is ambiguous; more than one request could fit this window.",
  unavailable: "No association evidence was recorded.",
} as const;

export function buildObservationView(
  window: CacheWindow,
  observation: CacheObservation,
): ObservationView {
  const rows: WindowDetailRow[] = [
    { label: "Recorded model", value: observation.model },
    {
      label: "Recorded cache reads",
      value:
        observation.cacheReadTokens == null
          ? "Not recorded"
          : formatNumberFull(observation.cacheReadTokens),
    },
  ];
  if (observation.inputTokens != null) {
    rows.push({ label: "Recorded input", value: formatNumberFull(observation.inputTokens) });
  }
  if (observation.cacheWriteTokens != null) {
    rows.push({
      label: "Recorded cache writes",
      value: formatNumberFull(observation.cacheWriteTokens),
    });
  }
  if (observation.recordedAt) {
    rows.push({ label: "Request recorded", value: formatTime(observation.recordedAt) });
  }
  rows.push({ label: "Match", value: ATTRIBUTION_NOTES[observation.attribution] });

  return {
    windowIndex: observation.windowIndex,
    pairing: `Predicted ${OUTCOME_LABELS[window.outcome].toLowerCase()}; the resuming request ${describeReads(observation)}.`,
    comparisonLabel: COMPARISON_LABELS[observation.comparison],
    comparisonNote: comparisonNote(observation),
    // A disagreement is the informative case, so it is the one drawn out.
    tone: observation.comparison === "differs" ? "warning" : "neutral",
    rows,
  };
}
