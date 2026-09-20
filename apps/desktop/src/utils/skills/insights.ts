/**
 * The one or two things worth saying about a skills catalog, derived from the
 * same entries the grid renders.
 *
 * An insight states a fact and the filter that shows the evidence — it never
 * acts. Each is dismissible, and dismissal is remembered per insight rather
 * than for the whole bar, so hiding "unused skills" does not also hide a
 * later "used but disabled".
 */

import type { SkillEntry, SkillFlag } from "./entries";

export interface SkillInsight {
  /** Stable across sessions, so a dismissal keeps applying. */
  id: string;
  text: string;
  /** The flag chip this insight's "Show them" applies. */
  flag: SkillFlag;
  tone: "warning" | "accent";
}

function plural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function compactTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

/**
 * Ranked most actionable first, so a caller showing only the top one shows
 * the one worth acting on.
 */
export function deriveSkillInsights(
  entries: readonly SkillEntry[],
  rangeLabel: string,
): SkillInsight[] {
  const insights: SkillInsight[] = [];

  const unused = entries.filter((entry) => entry.flags.includes("unused"));
  if (unused.length > 0) {
    const tokens = unused.reduce((sum, entry) => sum + entry.listingTokens, 0);
    insights.push({
      id: "unused",
      flag: "unused",
      tone: "warning",
      text: `${plural(unused.length, "enabled skill")} unused in ${rangeLabel} · about ${compactTokens(tokens)} tokens on every turn`,
    });
  }

  const usedDisabled = entries.filter((entry) => entry.flags.includes("usedDisabled"));
  if (usedDisabled.length > 0) {
    const uses = usedDisabled.reduce((sum, entry) => sum + (entry.usage?.uses ?? 0), 0);
    insights.push({
      id: "used-disabled",
      flag: "usedDisabled",
      tone: "accent",
      text: `${plural(usedDisabled.length, "disabled skill")} still invoked ${plural(uses, "time")} in ${rangeLabel}`,
    });
  }

  const missing = entries.filter((entry) => entry.kind === "missing");
  if (missing.length > 0) {
    insights.push({
      id: "missing",
      flag: "missing",
      tone: "warning",
      text: `${plural(missing.length, "skill")} used in sessions ${missing.length === 1 ? "is" : "are"} not installed here`,
    });
  }

  const drifted = entries.filter((entry) => entry.flags.includes("drifted"));
  if (drifted.length > 0) {
    insights.push({
      id: "drifted",
      flag: "drifted",
      tone: "accent",
      text: `${plural(drifted.length, "skill")} changed since ${drifted.length === 1 ? "it was" : "they were"} last used`,
    });
  }

  return insights;
}
