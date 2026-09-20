import type { SkillUsageSummary } from "@tracepilot/types";
import { computed, type ShallowRef } from "vue";
import { buildSkillEntries, filterAndSortSkills, type SkillFlag } from "@/utils/skills/entries";
import type { UsageRange } from "@/utils/usage/range";
import type { SkillsContext } from "./context";

export function createSkillsComputed(
  context: SkillsContext,
  usage: ShallowRef<SkillUsageSummary | null>,
  range: { value: UsageRange },
) {
  const { skills, searchQuery, filterScope, filterFlags, sort } = context;

  /**
   * Installed skills merged with cross-session usage. Skills used in sessions
   * but no longer installed appear here too, so they can be found rather than
   * silently vanishing from the catalog.
   */
  const entries = computed(() => buildSkillEntries(skills.value, usage.value, range.value));

  const filteredSkills = computed(() =>
    filterAndSortSkills(entries.value, {
      scope: filterScope.value,
      flags: filterFlags.value,
      search: searchQuery.value,
      sort: sort.value,
    }),
  );

  const globalSkills = computed(() => skills.value.filter((skill) => skill.scope === "global"));
  const repoSkills = computed(() => skills.value.filter((skill) => skill.scope === "repository"));
  const builtinSkills = computed(() => skills.value.filter((skill) => skill.scope === "builtin"));
  const missingSkills = computed(() => entries.value.filter((entry) => entry.kind === "missing"));

  /** Enabled skills used at least once in the selected range. */
  const usedSkillCount = computed(
    () => entries.value.filter((entry) => (entry.usage?.uses ?? 0) > 0).length,
  );
  const unusedEnabledSkills = computed(() =>
    entries.value.filter((entry) => entry.flags.includes("unused")),
  );
  /** Listing tokens those unused skills still cost on every turn. */
  const unusedEnabledTokens = computed(() =>
    unusedEnabledSkills.value.reduce((sum, entry) => sum + entry.listingTokens, 0),
  );

  /**
   * How many skills carry each flag, so a chip states its own size the way
   * the scope control does. Counted over every entry rather than the filtered
   * list, so a chip's number does not change as other filters are applied.
   */
  const flagCounts = computed(() => {
    const counts = {} as Record<SkillFlag, number>;
    for (const entry of entries.value) {
      for (const flag of entry.flags) counts[flag] = (counts[flag] ?? 0) + 1;
    }
    return counts;
  });

  const tokenBudget = computed(() => {
    const enabled = skills.value.filter((skill) => skill.enabled);
    return {
      totalSkills: skills.value.length,
      enabledSkills: enabled.length,
      totalTokens: skills.value.reduce((sum, skill) => sum + skill.frontmatterTokens, 0),
      enabledTokens: enabled.reduce((sum, skill) => sum + skill.frontmatterTokens, 0),
    };
  });

  return {
    entries,
    filteredSkills,
    globalSkills,
    repoSkills,
    builtinSkills,
    missingSkills,
    usedSkillCount,
    unusedEnabledSkills,
    flagCounts,
    unusedEnabledTokens,
    tokenBudget,
  };
}
