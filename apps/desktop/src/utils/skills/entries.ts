/**
 * Merging installed skills with cross-session usage, and the flags that come
 * out of it.
 *
 * Identity resolution runs **directory first, then name**, because the two
 * disagree in practice: a skill named `testing-usability` loads from a
 * `usability-testing` directory, and the same project skill can exist in
 * several clones under the same name. The directory the CLI recorded is what
 * identifies the installed skill; the name is the fallback when no path was
 * recorded at all (SDK-provided skills) or the directory is gone.
 */

import type {
  SkillScope,
  SkillSummary,
  SkillUsageStats,
  SkillUsageSummary,
} from "@tracepilot/types";
import { rangeStart, type UsageRange } from "@/utils/usage/range";

/**
 * - `installed`: a `SKILL.md` was found on disk.
 * - `missing`: used in sessions, but nothing matching is installed now.
 */
export type SkillEntryKind = "installed" | "missing";

export type SkillFlag = "unused" | "dormant" | "usedDisabled" | "missing" | "drifted" | "shadowed";

export type SkillScopeFilter = "all" | SkillScope | "missing";

export type SkillSortKey = "uses" | "name" | "lastUsed" | "listingCost";

export interface SkillEntry {
  /** The installed directory, or `name:<skill>` for a missing skill. */
  key: string;
  name: string;
  description: string;
  kind: SkillEntryKind;
  scope: SkillScope | "missing";
  /** `null` for a skill that is no longer installed. */
  skill: SkillSummary | null;
  usage: SkillUsageStats | null;
  enabled: boolean;
  /** Tokens this skill adds to every turn while enabled. */
  listingTokens: number;
  flags: SkillFlag[];
  /**
   * Where a missing skill was last loaded from, so it can be found again.
   * `null` when the CLI recorded no path.
   */
  lastKnownPath: string | null;
}

/** A skill unused for this long is worth reviewing, not yet worth removing. */
export const DORMANT_DAYS = 60;

/** The CLI prefers the most local definition when a name exists twice. */
const SCOPE_PRECEDENCE: Record<SkillScope, number> = {
  repository: 0,
  global: 1,
  builtin: 2,
};

const lower = (value: string) => value.trim().toLowerCase();

/** Case-folded directory with `/` separators, matching the indexer's key. */
export function normalizeDirectory(directory: string): string {
  return directory.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * A skill's last known path, shortened to the two parts that identify it: the
 * root it came from and the folder it lived in. A full absolute path never
 * fits a card and truncating it at the edge cuts off the folder name, which
 * is the one part worth reading — `testing-usability` lived in a directory
 * called `usability-testing`, and that mismatch is the whole point.
 *
 * The full path stays available as the element's title.
 */
export function shortenSkillPath(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  // A POSIX path's leading separator is its root, not an empty segment.
  const root = /^[\\/]/.test(path) ? separator : "";
  const segments = path.split(/[\\/]+/).filter(Boolean);
  // The file name says nothing a card does not already show.
  if (segments.at(-1)?.toLowerCase() === "skill.md") segments.pop();
  if (segments.length <= 4) return root + segments.join(separator);
  return root + [...segments.slice(0, 3), "…", segments.at(-1)].join(separator);
}

/** Route id for an entry: its directory, or `name:<skill>` when missing. */
export function skillRouteId(entry: Pick<SkillEntry, "skill" | "name">): string {
  return entry.skill ? entry.skill.directory : `name:${entry.name}`;
}

/**
 * The installed skill a usage row belongs to.
 *
 * A row can name several directories when the same skill was used from more
 * than one clone; any of them resolving is enough to call it installed.
 */
function matchInstalled(
  usage: SkillUsageStats,
  byDirectory: Map<string, SkillSummary>,
  byName: Map<string, SkillSummary>,
): SkillSummary | null {
  for (const path of usage.paths) {
    const match = byDirectory.get(path.directory);
    if (match) return match;
  }
  return byName.get(usage.normalizedName) ?? null;
}

function computeFlags(
  entry: Omit<SkillEntry, "flags">,
  usage: SkillUsageStats | null,
  shadowedNames: ReadonlySet<string>,
  range: UsageRange,
  now: Date,
  /**
   * Whether the index recorded any skill use at all in this range. With none,
   * "unused" would describe the index rather than the skill, so it is
   * withheld until there is something to have been absent from.
   */
  hasUsageEvidence: boolean,
): SkillFlag[] {
  const flags: SkillFlag[] = [];
  const uses = usage?.uses ?? 0;

  if (entry.kind === "missing") {
    flags.push("missing");
  } else if (hasUsageEvidence && entry.enabled && uses === 0) {
    const start = rangeStart(range, now);
    const modified = entry.skill?.modifiedAt ? Date.parse(entry.skill.modifiedAt) : Number.NaN;
    // A skill installed inside the range has not had a fair chance yet.
    if (!start || Number.isNaN(modified) || modified < start.getTime()) flags.push("unused");
  }

  if (entry.enabled && uses > 0 && usage?.lastUsed) {
    const lastUsed = Date.parse(usage.lastUsed);
    const cutoff = now.getTime() - DORMANT_DAYS * 86_400_000;
    if (!Number.isNaN(lastUsed) && lastUsed < cutoff) flags.push("dormant");
  }

  if (entry.kind === "installed" && !entry.enabled && uses > 0) flags.push("usedDisabled");

  // Only an invocation that carried content can be compared, so a skill used
  // solely through fallback rows is never called drifted.
  if (
    entry.skill &&
    usage?.latestContentSha256 &&
    usage.latestContentSha256 !== entry.skill.contentSha256
  ) {
    flags.push("drifted");
  }

  if (entry.kind === "installed" && shadowedNames.has(lower(entry.name))) flags.push("shadowed");

  return flags;
}

/** Names installed in more than one scope, where precedence decides the winner. */
export function shadowedSkillNames(skills: readonly SkillSummary[]): Set<string> {
  const scopesByName = new Map<string, Set<SkillScope>>();
  for (const skill of skills) {
    const name = lower(skill.name);
    const scopes = scopesByName.get(name) ?? new Set<SkillScope>();
    scopes.add(skill.scope);
    scopesByName.set(name, scopes);
  }
  return new Set([...scopesByName].filter(([, scopes]) => scopes.size > 1).map(([name]) => name));
}

/** The installed skill the CLI would pick for a name, by scope precedence. */
export function winningSkill(
  skills: readonly SkillSummary[],
  name: string,
): SkillSummary | undefined {
  return skills
    .filter((skill) => lower(skill.name) === lower(name))
    .sort((a, b) => SCOPE_PRECEDENCE[a.scope] - SCOPE_PRECEDENCE[b.scope])[0];
}

/**
 * Merge installed skills with usage. Every usage row attaches to at most one
 * installed skill; rows that match nothing become missing entries, which is
 * how a skill invoked from a directory that no longer exists stays visible.
 */
export function buildSkillEntries(
  skills: readonly SkillSummary[],
  usage: SkillUsageSummary | null,
  range: UsageRange,
  now: Date = new Date(),
): SkillEntry[] {
  const byDirectory = new Map<string, SkillSummary>();
  const byName = new Map<string, SkillSummary>();
  // Precedence order first, so the winning scope claims a name.
  for (const skill of [...skills].sort(
    (a, b) => SCOPE_PRECEDENCE[a.scope] - SCOPE_PRECEDENCE[b.scope],
  )) {
    byDirectory.set(normalizeDirectory(skill.directory), skill);
    const name = lower(skill.name);
    if (!byName.has(name)) byName.set(name, skill);
  }

  const usageBySkill = new Map<string, SkillUsageStats>();
  const unmatched: SkillUsageStats[] = [];
  for (const stats of usage?.skills ?? []) {
    const match = matchInstalled(stats, byDirectory, byName);
    if (!match) {
      unmatched.push(stats);
      continue;
    }
    const key = normalizeDirectory(match.directory);
    const existing = usageBySkill.get(key);
    // Two spellings of one name can both resolve here; the busier one wins
    // rather than silently replacing the other.
    if (!existing || stats.uses > existing.uses) usageBySkill.set(key, stats);
  }

  const shadowed = shadowedSkillNames(skills);
  const hasEvidence = (usage?.totalUses ?? 0) > 0;
  const entries: SkillEntry[] = skills.map((skill) => {
    const key = normalizeDirectory(skill.directory);
    const stats = usageBySkill.get(key) ?? null;
    const base: Omit<SkillEntry, "flags"> = {
      key,
      name: skill.name,
      description: skill.description,
      kind: "installed",
      scope: skill.scope,
      skill,
      usage: stats,
      enabled: skill.enabled,
      listingTokens: skill.frontmatterTokens,
      lastKnownPath: null,
    };
    return { ...base, flags: computeFlags(base, stats, shadowed, range, now, hasEvidence) };
  });

  for (const stats of unmatched) {
    const base: Omit<SkillEntry, "flags"> = {
      key: `name:${stats.normalizedName}`,
      name: stats.name,
      description: stats.description ?? "",
      kind: "missing",
      scope: "missing",
      skill: null,
      usage: stats,
      // A skill that is not installed costs nothing per turn and cannot be
      // toggled, so it is neither enabled nor disabled.
      enabled: false,
      listingTokens: 0,
      lastKnownPath: stats.paths[0]?.path ?? null,
    };
    entries.push({ ...base, flags: computeFlags(base, stats, shadowed, range, now, hasEvidence) });
  }

  return entries;
}

export interface SkillEntryFilter {
  scope: SkillScopeFilter;
  flags: ReadonlySet<SkillFlag>;
  search: string;
  sort: SkillSortKey;
}

export function matchesScope(entry: SkillEntry, scope: SkillScopeFilter): boolean {
  return scope === "all" || entry.scope === scope;
}

/** Filter by scope, every selected flag and a search over names and descriptions. */
export function filterAndSortSkills(
  entries: readonly SkillEntry[],
  filter: SkillEntryFilter,
): SkillEntry[] {
  const query = lower(filter.search);
  const result = entries.filter(
    (entry) =>
      matchesScope(entry, filter.scope) &&
      [...filter.flags].every((flag) => entry.flags.includes(flag)) &&
      (!query || [entry.name, entry.description].some((text) => lower(text).includes(query))),
  );
  const byName = (a: SkillEntry, b: SkillEntry) => a.name.localeCompare(b.name);
  // Entries with no value for the sort key sort last either way, so an
  // unused skill never displaces a used one at the top of the list.
  const numeric =
    (value: (entry: SkillEntry) => number | null) => (a: SkillEntry, b: SkillEntry) => {
      const left = value(a);
      const right = value(b);
      if (left == null) return right == null ? byName(a, b) : 1;
      if (right == null) return -1;
      return right - left || byName(a, b);
    };
  const comparators: Record<SkillSortKey, (a: SkillEntry, b: SkillEntry) => number> = {
    name: byName,
    uses: numeric((entry) => entry.usage?.uses ?? 0),
    lastUsed: numeric((entry) => (entry.usage?.lastUsed ? Date.parse(entry.usage.lastUsed) : null)),
    listingCost: numeric((entry) => entry.listingTokens || null),
  };
  return result.sort(comparators[filter.sort]);
}
