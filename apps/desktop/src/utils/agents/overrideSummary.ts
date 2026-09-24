import type { SubagentOverride } from "@tracepilot/types";

/** One apply or reset from the override dialog, before and after. */
export interface OverrideChange {
  agentType: string;
  previous: SubagentOverride | null;
  next: SubagentOverride | null;
  wasDisabled: boolean;
  disabled: boolean;
  /** Where the setting was written; omitted from the copy when unknown. */
  settingsPath?: string | null;
}

export interface OverrideChangeSummary {
  title: string;
  message: string;
}

const PARTS: readonly [keyof SubagentOverride, string][] = [
  ["model", "model"],
  ["effortLevel", "effort"],
  ["contextTier", "context tier"],
];

/** `model gpt-5.5 · effort high`, or `null` when nothing is set. */
export function describeOverrideValues(value: SubagentOverride | null): string | null {
  if (!value) return null;
  const parts = PARTS.flatMap(([key, label]) => (value[key] ? [`${label} ${value[key]}`] : []));
  return parts.length ? parts.join(" · ") : null;
}

/** Toast copy confirming what a saved override changed and where it lives. */
export function describeOverrideChange(change: OverrideChange): OverrideChangeSummary {
  const { agentType, previous, next, wasDisabled, disabled } = change;
  const nextValues = describeOverrideValues(next);
  const valuesChanged = describeOverrideValues(previous) !== nextValues;
  const where = change.settingsPath ? `Written to ${change.settingsPath}.` : "";

  if (!nextValues && !disabled && (describeOverrideValues(previous) || wasDisabled)) {
    return {
      title: `Override removed for ${agentType}`,
      message: ["The agent follows its definition again.", where].filter(Boolean).join(" "),
    };
  }

  const lines: string[] = [];
  if (valuesChanged) lines.push(nextValues ? `Now runs with ${nextValues}.` : "Values cleared.");
  if (disabled !== wasDisabled) {
    lines.push(disabled ? "Disabled: the CLI will not run it." : "Enabled again.");
  }
  if (where) lines.push(where);
  return {
    title: valuesChanged ? `Override saved for ${agentType}` : `${agentType} updated`,
    message: lines.join(" "),
  };
}
