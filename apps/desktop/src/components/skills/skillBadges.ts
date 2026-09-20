import type { SkillScope } from "@tracepilot/types";
import { DORMANT_DAYS, type SkillFlag } from "@/utils/skills/entries";

export type BadgeTone = "accent" | "success" | "warning" | "danger" | "done" | "neutral";

interface ScopeBadge {
  label: string;
  tone: BadgeTone;
}

const SCOPE_BADGES: Readonly<Record<SkillScope | "missing", ScopeBadge>> = {
  global: { label: "Global", tone: "accent" },
  repository: { label: "Project", tone: "success" },
  builtin: { label: "Built-in", tone: "neutral" },
  missing: { label: "Not installed", tone: "warning" },
};

export function skillScopeBadge(scope: SkillScope | "missing"): ScopeBadge {
  return SCOPE_BADGES[scope];
}

export const SKILL_SCOPE_FILTERS: readonly { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "global", label: "Global" },
  { value: "repository", label: "Project" },
  { value: "builtin", label: "Built-in" },
  { value: "missing", label: "Not installed" },
];

interface FlagBadge {
  label: string;
  tone: BadgeTone;
  title: string;
}

/**
 * Each flag says what it means and what it is evidence of. None of them act
 * on their own — they narrow the list so you can decide.
 */
export const SKILL_FLAG_BADGES: Readonly<Record<SkillFlag, FlagBadge>> = {
  unused: {
    label: "Unused",
    tone: "warning",
    title:
      "Enabled and installed before this range began, but never invoked in it. It still costs its listing tokens on every turn.",
  },
  dormant: {
    label: "Dormant",
    tone: "neutral",
    title: `Enabled and last used more than ${DORMANT_DAYS} days ago.`,
  },
  usedDisabled: {
    label: "Used but disabled",
    tone: "accent",
    title: "Disabled in settings, yet sessions in this range still invoked it.",
  },
  missing: {
    label: "Not installed",
    tone: "warning",
    title:
      "Sessions invoked this skill but nothing matching is installed now. It may have been renamed, deleted, or come from a repository or plugin you no longer have.",
  },
  drifted: {
    label: "Changed since used",
    tone: "done",
    title:
      "The installed file differs from the content of the most recent invocation, so this usage describes an older version.",
  },
  shadowed: {
    label: "Shadowed",
    tone: "neutral",
    title:
      "The same name is installed in more than one scope. Copilot uses the most local one: project, then global, then built-in.",
  },
};

/**
 * Flag filter chips, in the order the manager shows them. `missing` is absent
 * on purpose: the scope control already has a "Not installed" option, and two
 * controls for one set would only disagree.
 */
export const SKILL_FLAG_FILTERS: readonly SkillFlag[] = [
  "unused",
  "usedDisabled",
  "dormant",
  "drifted",
  "shadowed",
];
