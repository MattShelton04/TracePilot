import type {
  AgentCatalog,
  AgentDefinitionSummary,
  AgentScope,
  AgentUsageStats,
  AgentUsageSummary,
  SubagentOverride,
  SubagentSettings,
} from "@tracepilot/types";
import { EMBEDDED_AGENT_IDENTITY, KNOWN_BUILTIN_AGENTS } from "./agentMeta";
import { type AgentUsageRange, rangeStart } from "./range";

/**
 * - `definition`: a definition file was found.
 * - `embedded`: a known built-in seen in sessions whose definition ships
 *   inside the CLI binary (or an older package) and is not on disk.
 * - `unresolved`: seen in sessions, but no definition was found anywhere
 *   (renamed, deleted, plugin removed, `--add-dir`).
 */
export type AgentEntryKind = "definition" | "embedded" | "unresolved";

export type AgentFlag = "unused" | "mismatch" | "failing" | "slow" | "overridden" | "disabled";

export type AgentScopeFilter = "all" | AgentScope | "unresolved";

export type AgentSortKey = "name" | "runs" | "failure" | "duration" | "lastUsed";

export interface AgentEntry {
  /** Definition id, or `name:<lower-case name>` for session-only agents. */
  key: string;
  name: string;
  displayName: string | null;
  description: string;
  kind: AgentEntryKind;
  /** Built-in for embedded agents; `unresolved` when nothing is known. */
  scope: AgentScope | "unresolved";
  definition: AgentDefinitionSummary | null;
  usage: AgentUsageStats | null;
  override: SubagentOverride | null;
  disabled: boolean;
  flags: AgentFlag[];
}

/** Flag thresholds (design §10). */
export const FAILING_MIN_RUNS = 20;
export const FAILING_RATE = 0.1;
export const SLOW_FACTOR = 3;
/** A trend over a handful of runs is noise, so `slow` needs a real sample. */
export const SLOW_MIN_RUNS = 10;

/** When several definitions share a name, the CLI prefers the most local. */
const SCOPE_PRECEDENCE: Record<AgentScope, number> = {
  project: 0,
  personal: 1,
  plugin: 2,
  builtin: 3,
};

const lower = (value: string) => value.trim().toLowerCase();

/** Route id for an entry: its file path, or `name:<agent>` for session-only agents. */
export function agentRouteId(entry: Pick<AgentEntry, "definition" | "name">): string {
  return entry.definition ? entry.definition.id : `name:${entry.name}`;
}

export function failureRate(usage: AgentUsageStats | null): number {
  if (!usage || usage.runs === 0) return 0;
  return (usage.failed + usage.cancelled) / usage.runs;
}

function hasOverride(value: SubagentOverride | null | undefined): value is SubagentOverride {
  return Boolean(value && (value.model || value.effortLevel || value.contextTier));
}

/** The `/subagents` override that applies to an agent, matched case-insensitively. */
export function findOverride(
  settings: SubagentSettings | null,
  names: string[],
): SubagentOverride | null {
  if (!settings) return null;
  const wanted = new Set(names.map(lower));
  const match = Object.entries(settings.overrides).find(([key]) => wanted.has(lower(key)));
  return match && hasOverride(match[1]) ? match[1] : null;
}

export function isDisabled(settings: SubagentSettings | null, names: string[]): boolean {
  if (!settings) return false;
  const wanted = new Set(names.map(lower));
  return settings.disabled.some((name) => wanted.has(lower(name)));
}

function computeFlags(
  entry: Omit<AgentEntry, "flags">,
  range: AgentUsageRange,
  now: Date,
): AgentFlag[] {
  const flags: AgentFlag[] = [];
  const usage = entry.usage;
  const custom = entry.definition && entry.definition.scope !== "builtin";
  if (custom && (usage?.runs ?? 0) === 0) {
    const start = rangeStart(range, now);
    const modified = entry.definition?.modifiedAt ? Date.parse(entry.definition.modifiedAt) : NaN;
    // A definition created inside the range has not had a fair chance yet.
    if (!start || Number.isNaN(modified) || modified < start.getTime()) flags.push("unused");
  }
  if (usage && usage.mismatchRuns > 0) flags.push("mismatch");
  if (usage && usage.runs >= FAILING_MIN_RUNS && failureRate(usage) > FAILING_RATE) {
    flags.push("failing");
  }
  const p90 = usage?.durationMs.p90;
  const previous = usage?.previousMedianDurationMs;
  if (
    usage &&
    usage.durationMs.count >= SLOW_MIN_RUNS &&
    p90 != null &&
    previous != null &&
    previous > 0 &&
    p90 > SLOW_FACTOR * previous
  ) {
    flags.push("slow");
  }
  if (entry.override) flags.push("overridden");
  if (entry.disabled) flags.push("disabled");
  return flags;
}

/**
 * Merge definitions with cross-session usage. Every usage row attaches to at
 * most one definition (the most local one with a matching name or file
 * stem); rows without a definition become embedded or unresolved entries.
 */
export function buildAgentEntries(
  catalog: AgentCatalog | null,
  usage: AgentUsageSummary | null,
  range: AgentUsageRange,
  now: Date = new Date(),
): AgentEntry[] {
  const settings = catalog?.settings ?? null;
  const usageByName = new Map<string, AgentUsageStats>();
  for (const stats of usage?.agents ?? []) usageByName.set(lower(stats.name), stats);

  const definitions = [...(catalog?.definitions ?? [])].sort(
    (a, b) => SCOPE_PRECEDENCE[a.scope] - SCOPE_PRECEDENCE[b.scope],
  );
  const claimed = new Set<string>();
  const entries: Omit<AgentEntry, "flags">[] = definitions.map((definition) => {
    const names = [definition.name, definition.fileStem];
    const key = names.map(lower).find((name) => usageByName.has(name) && !claimed.has(name));
    if (key) claimed.add(key);
    return {
      key: definition.id,
      name: definition.name,
      displayName: definition.displayName,
      description: definition.description,
      kind: "definition",
      scope: definition.scope,
      definition,
      usage: key ? (usageByName.get(key) ?? null) : null,
      override: findOverride(settings, names),
      disabled: isDisabled(settings, names),
    };
  });

  for (const [key, stats] of usageByName) {
    if (claimed.has(key)) continue;
    const embedded = KNOWN_BUILTIN_AGENTS.has(key);
    // A known built-in is described by its curated identity, never by what
    // one run was asked to do.
    const identity = embedded ? EMBEDDED_AGENT_IDENTITY[key] : undefined;
    entries.push({
      key: `name:${key}`,
      name: stats.name,
      displayName: identity ? identity.displayName : stats.displayName,
      description: identity ? identity.description : (stats.description ?? ""),
      kind: embedded ? "embedded" : "unresolved",
      scope: embedded ? "builtin" : "unresolved",
      definition: null,
      usage: stats,
      override: findOverride(settings, [stats.name]),
      disabled: isDisabled(settings, [stats.name]),
    });
  }

  return entries.map((entry) => ({ ...entry, flags: computeFlags(entry, range, now) }));
}

export interface AgentEntryFilter {
  scope: AgentScopeFilter;
  flags: ReadonlySet<AgentFlag>;
  search: string;
  sort: AgentSortKey;
}

export function matchesScope(entry: AgentEntry, scope: AgentScopeFilter): boolean {
  return scope === "all" || entry.scope === scope;
}

/** Filter by scope, every selected flag and a search over names and descriptions. */
export function filterAndSortEntries(
  entries: AgentEntry[],
  filter: AgentEntryFilter,
): AgentEntry[] {
  const query = lower(filter.search);
  const result = entries.filter(
    (entry) =>
      matchesScope(entry, filter.scope) &&
      [...filter.flags].every((flag) => entry.flags.includes(flag)) &&
      (!query ||
        [entry.name, entry.displayName ?? "", entry.description].some((text) =>
          lower(text).includes(query),
        )),
  );
  const byName = (a: AgentEntry, b: AgentEntry) => a.name.localeCompare(b.name);
  const numeric =
    (value: (entry: AgentEntry) => number | null) => (a: AgentEntry, b: AgentEntry) => {
      const left = value(a);
      const right = value(b);
      // Entries without data sort last in either case.
      if (left == null) return right == null ? byName(a, b) : 1;
      if (right == null) return -1;
      return right - left || byName(a, b);
    };
  const comparators: Record<AgentSortKey, (a: AgentEntry, b: AgentEntry) => number> = {
    name: byName,
    runs: numeric((entry) => entry.usage?.runs ?? 0),
    failure: numeric((entry) => (entry.usage?.runs ? failureRate(entry.usage) : null)),
    duration: numeric((entry) => entry.usage?.durationMs.p50 ?? null),
    lastUsed: numeric((entry) => (entry.usage?.lastUsed ? Date.parse(entry.usage.lastUsed) : null)),
  };
  return result.sort(comparators[filter.sort]);
}
