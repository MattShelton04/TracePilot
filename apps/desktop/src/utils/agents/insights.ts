import { formatNumberFull } from "@tracepilot/types";
import { type AgentEntry, type AgentFlag, type AgentScopeFilter, failureRate } from "./entries";

export interface AgentInsight {
  id: string;
  tone: "info" | "success" | "warning";
  text: string;
  /** Applying the insight's filter narrows the grid to the agents it describes. */
  filter?: { flag?: AgentFlag; scope?: AgentScopeFilter };
}

const percent = (value: number) =>
  `${value < 0.1 && value > 0 ? (value * 100).toFixed(1) : Math.round(value * 100)}%`;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${formatNumberFull(count)} ${count === 1 ? one : many}`;

/** Short, actionable observations for the insight bar, most useful first. */
export function buildAgentInsights(entries: AgentEntry[]): AgentInsight[] {
  const insights: AgentInsight[] = [];
  const used = entries.filter((entry) => (entry.usage?.runs ?? 0) > 0);
  const top = [...used].sort((a, b) => (b.usage?.runs ?? 0) - (a.usage?.runs ?? 0))[0];
  if (top?.usage) {
    const failures = top.usage.failed + top.usage.cancelled;
    insights.push({
      id: "top",
      tone: failures === 0 ? "success" : "info",
      text: `${top.name} ran ${plural(top.usage.runs, "time")}; ${
        failures === 0 ? "no failures" : `${percent(failureRate(top.usage))} failed or cancelled`
      }.`,
    });
  }

  const mismatched = entries.filter((entry) => entry.flags.includes("mismatch"));
  if (mismatched.length > 0) {
    insights.push({
      id: "mismatch",
      tone: "warning",
      text: `${plural(mismatched.length, "agent")} ran on a model different from the one configured (CLI 1.0.83+).`,
      filter: { flag: "mismatch" },
    });
  }

  const failing = entries.filter((entry) => entry.flags.includes("failing"));
  if (failing.length === 1 && failing[0].usage) {
    const usage = failing[0].usage;
    insights.push({
      id: "failing",
      tone: "warning",
      text: `${failing[0].name} failed or was cancelled in ${percent(failureRate(usage))} of ${plural(usage.runs, "run")}.`,
      filter: { flag: "failing" },
    });
  } else if (failing.length > 1) {
    insights.push({
      id: "failing",
      tone: "warning",
      text: `${plural(failing.length, "agent")} fail or are cancelled in more than 10% of runs.`,
      filter: { flag: "failing" },
    });
  }

  const unused = entries.filter((entry) => entry.flags.includes("unused"));
  if (unused.length === 1) {
    insights.push({
      id: "unused",
      tone: "info",
      text: `Custom agent ${unused[0].name} has not been used in this range.`,
      filter: { flag: "unused" },
    });
  } else if (unused.length > 1) {
    insights.push({
      id: "unused",
      tone: "info",
      text: `${plural(unused.length, "custom agent")} have not been used in this range.`,
      filter: { flag: "unused" },
    });
  }

  const unresolved = entries.filter((entry) => entry.kind === "unresolved");
  if (unresolved.length > 0) {
    insights.push({
      id: "unresolved",
      tone: "info",
      text: `${plural(unresolved.length, "agent")} seen in sessions ${unresolved.length === 1 ? "has" : "have"} no definition on disk.`,
      filter: { scope: "unresolved" },
    });
  }
  return insights;
}
