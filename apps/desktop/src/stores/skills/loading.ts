import { skillsGetSkill, skillsListAll } from "@tracepilot/client";
import { runAction, runMutation } from "@tracepilot/ui";
import type { SkillsContext } from "./context";

export function createSkillsLoadingActions(context: SkillsContext) {
  const { skills, selectedSkill, loading, error, currentRepoRoot, loadGuard } = context;

  async function loadSkills(repoRoot?: string) {
    if (repoRoot !== undefined) {
      currentRepoRoot.value = repoRoot;
    }
    await runAction({
      loading,
      error,
      guard: loadGuard,
      action: () => skillsListAll(currentRepoRoot.value),
      onSuccess: (result) => {
        skills.value = result;
      },
    });
  }

  async function getSkill(dir: string) {
    selectedSkill.value = null;
    return runMutation(error, async () => {
      const skill = await skillsGetSkill(dir);
      selectedSkill.value = skill;
      return skill;
    });
  }

  return {
    loadSkills,
    getSkill,
  };
}
