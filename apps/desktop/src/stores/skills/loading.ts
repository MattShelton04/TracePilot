import { skillsGetSkill, skillsListAll } from "@tracepilot/client";
import { runAction, runMutation } from "@tracepilot/ui";
import type { SkillsContext } from "./context";

export function createSkillsLoadingActions(context: SkillsContext) {
  const { skills, diagnostics, selectedSkill, loading, error, currentRepoRoot, loadGuard } =
    context;

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
        // Accept the legacy array shape from older test/mocked backends during rolling upgrades.
        if (Array.isArray(result)) {
          skills.value = result;
          diagnostics.value = [];
        } else {
          skills.value = result.skills;
          diagnostics.value = result.diagnostics;
        }
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
