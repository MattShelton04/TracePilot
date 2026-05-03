import { computed } from "vue";
import type { SkillsContext } from "./context";

export function createSkillsComputed(context: SkillsContext) {
  const { skills, searchQuery, filterScope } = context;

  const sortedSkills = computed(() =>
    [...skills.value].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const globalSkills = computed(() => skills.value.filter((s) => s.scope === "global"));

  const repoSkills = computed(() => skills.value.filter((s) => s.scope === "repository"));

  const filteredSkills = computed(() => {
    let list = sortedSkills.value;

    if (filterScope.value !== "all") {
      list = list.filter((s) => s.scope === filterScope.value);
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      );
    }

    return list;
  });

  const tokenBudget = computed(() => {
    const total = skills.value.length;
    const enabled = skills.value.filter((s) => s.enabled).length;
    const totalTokens = skills.value.reduce((sum, s) => sum + s.estimatedTokens, 0);
    const enabledTokens = skills.value
      .filter((s) => s.enabled)
      .reduce((sum, s) => sum + s.estimatedTokens, 0);
    return { totalSkills: total, enabledSkills: enabled, totalTokens, enabledTokens };
  });

  return {
    sortedSkills,
    globalSkills,
    repoSkills,
    filteredSkills,
    tokenBudget,
  };
}
