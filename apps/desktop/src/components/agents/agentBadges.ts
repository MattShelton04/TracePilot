import type { AgentScope } from "@tracepilot/types";
import type { AgentEntry, AgentFlag } from "@/utils/agents/entries";
import { FAILING_MIN_RUNS, FAILING_RATE, SLOW_FACTOR } from "@/utils/agents/entries";

export type BadgeTone = "accent" | "success" | "warning" | "danger" | "done" | "neutral";

interface ScopeBadge {
  label: string;
  tone: BadgeTone;
}

const SCOPE_BADGES: Readonly<Record<AgentScope | "unresolved", ScopeBadge>> = {
  builtin: { label: "Built-in", tone: "neutral" },
  personal: { label: "Personal", tone: "accent" },
  project: { label: "Project", tone: "success" },
  plugin: { label: "Plugin", tone: "done" },
  unresolved: { label: "Unresolved", tone: "warning" },
};

export function scopeBadge(scope: AgentScope | "unresolved"): ScopeBadge {
  return SCOPE_BADGES[scope];
}

export const SCOPE_FILTER_LABELS: readonly { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "builtin", label: "Built-in" },
  { value: "personal", label: "Personal" },
  { value: "project", label: "Project" },
  { value: "plugin", label: "Plugin" },
  { value: "unresolved", label: "Unresolved" },
];

interface FlagBadge {
  label: string;
  tone: BadgeTone;
  title: string;
}

export const FLAG_BADGES: Readonly<Record<AgentFlag, FlagBadge>> = {
  unused: {
    label: "Unused",
    tone: "neutral",
    title: "A custom agent older than the range with no runs in it.",
  },
  mismatch: {
    label: "Model mismatch",
    tone: "warning",
    title: "Some runs dispatched a model other than the configured one (CLI 1.0.83+).",
  },
  failing: {
    label: "Failing",
    tone: "danger",
    title: `More than ${FAILING_RATE * 100}% of at least ${FAILING_MIN_RUNS} runs failed or were cancelled.`,
  },
  slow: {
    label: "Slower",
    tone: "warning",
    title: `p90 duration is more than ${SLOW_FACTOR}× this agent's median in the previous window.`,
  },
  overridden: {
    label: "Overridden",
    tone: "accent",
    title: "A /subagents setting overrides this agent's definition.",
  },
  disabled: {
    label: "Disabled",
    tone: "danger",
    title: "Listed in disabledSubagents, so the CLI will not run it.",
  },
};

/** Flag filter chips, in the order the manager shows them. */
export const FLAG_FILTERS: readonly AgentFlag[] = [
  "unused",
  "mismatch",
  "failing",
  "slow",
  "overridden",
  "disabled",
];

/** The models an agent card shows: the override first when one applies. */
export function cardModels(entry: AgentEntry): string[] {
  if (entry.override?.model) return [entry.override.model];
  return entry.definition?.fields.models ?? [];
}
