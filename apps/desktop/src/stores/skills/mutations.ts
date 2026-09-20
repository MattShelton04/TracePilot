import {
  skillsCreate,
  skillsDelete,
  skillsDuplicate,
  skillsRename,
  skillsSetEnabled,
  skillsUpdate,
  skillsUpdateRaw,
} from "@tracepilot/client";
import type { SkillFrontmatter } from "@tracepilot/types";
import { runMutation } from "@tracepilot/ui";
import type { LoadSkills, SkillsContext } from "./context";

export function createSkillsMutationActions(context: SkillsContext, loadSkills: LoadSkills) {
  const { skills, selectedSkill, error } = context;
  const enablementPending = new Set<string>();

  async function createSkill(name: string, desc: string, body: string): Promise<string | null> {
    return runMutation(error, async () => {
      const dir = await skillsCreate(name, desc, body);
      await loadSkills();
      return dir;
    });
  }

  async function updateSkill(dir: string, fm: SkillFrontmatter, body: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsUpdate(dir, fm, body);
        await loadSkills();
        return true as const;
      })) ?? false
    );
  }

  async function updateSkillRaw(dir: string, content: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsUpdateRaw(dir, content);
        await loadSkills();
        return true as const;
      })) ?? false
    );
  }

  async function deleteSkill(dir: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsDelete(dir);
        skills.value = skills.value.filter((s) => s.directory !== dir);
        if (selectedSkill.value?.directory === dir) {
          selectedSkill.value = null;
        }
        return true as const;
      })) ?? false
    );
  }

  async function renameSkill(dir: string, newName: string): Promise<string | null> {
    return runMutation(error, async () => {
      const newDir = await skillsRename(dir, newName);
      await loadSkills();
      return newDir;
    });
  }

  async function duplicateSkill(dir: string, newName: string): Promise<string | null> {
    return runMutation(error, async () => {
      const newDir = await skillsDuplicate(dir, newName);
      await loadSkills();
      return newDir;
    });
  }

  async function setSkillEnabled(directory: string, enabled: boolean): Promise<boolean> {
    if (enablementPending.has(directory)) return false;
    enablementPending.add(directory);
    try {
      return (
        (await runMutation(error, async () => {
          await skillsSetEnabled(directory, enabled);
          // Re-read effective settings: global restrictions and duplicate names
          // within one repository can affect more than the clicked definition.
          await loadSkills();
          const updated = skills.value.find(
            (skill) => skill.directory === selectedSkill.value?.directory,
          );
          if (selectedSkill.value && updated) {
            selectedSkill.value = {
              ...selectedSkill.value,
              enabled: updated.enabled,
              disabledReason: updated.disabledReason,
            };
          }
          return true as const;
        })) ?? false
      );
    } finally {
      enablementPending.delete(directory);
    }
  }

  return {
    createSkill,
    updateSkill,
    updateSkillRaw,
    deleteSkill,
    renameSkill,
    duplicateSkill,
    setSkillEnabled,
  };
}
