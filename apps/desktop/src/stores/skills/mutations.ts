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

  async function setSkillEnabled(name: string, enabled: boolean): Promise<boolean> {
    const key = name.trim().toLowerCase();
    if (enablementPending.has(key)) return false;

    const previousSkill = skills.value.find((skill) => skill.name.trim().toLowerCase() === key);
    const previousSelected =
      selectedSkill.value?.frontmatter.name.trim().toLowerCase() === key
        ? selectedSkill.value
        : undefined;
    skills.value = skills.value.map((skill) =>
      skill.name.trim().toLowerCase() === key
        ? { ...skill, enabled, disabledReason: enabled ? undefined : "user" }
        : skill,
    );
    if (selectedSkill.value?.frontmatter.name.trim().toLowerCase() === key) {
      selectedSkill.value = {
        ...selectedSkill.value,
        enabled,
        disabledReason: enabled ? undefined : "user",
      };
    }

    enablementPending.add(key);
    let succeeded = false;
    try {
      succeeded =
        (await runMutation(error, async () => {
          await skillsSetEnabled(name, enabled);
          return true as const;
        })) ?? false;
    } finally {
      enablementPending.delete(key);
    }

    if (!succeeded) {
      if (previousSkill) {
        skills.value = skills.value.map((skill) =>
          skill.name.trim().toLowerCase() === key ? previousSkill : skill,
        );
      }
      if (previousSelected) selectedSkill.value = previousSelected;
    }
    return succeeded;
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
