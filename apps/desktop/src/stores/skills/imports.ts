import {
  skillsImportFile,
  skillsImportGitHub,
  skillsImportGitHubSkill,
  skillsImportLocal,
} from "@tracepilot/client";
import type { SkillImportResult } from "@tracepilot/types";
import { runMutation } from "@tracepilot/ui";
import type { LoadSkills, SkillsContext } from "./context";

export function createSkillsImportActions(context: SkillsContext, loadSkills: LoadSkills) {
  const { error } = context;

  async function importLocal(
    sourceDir: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportLocal(sourceDir, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function importFile(
    path: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportFile(path, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function importGitHub(
    owner: string,
    repo: string,
    skillPath?: string,
    gitRef?: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportGitHub(owner, repo, skillPath, gitRef, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  async function importGitHubSkill(
    owner: string,
    repo: string,
    skillPath: string,
    gitRef?: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillImportResult | null> {
    return runMutation(error, async () => {
      const result = await skillsImportGitHubSkill(owner, repo, skillPath, gitRef, scope, repoRoot);
      await loadSkills();
      return result;
    });
  }

  return {
    importLocal,
    importFile,
    importGitHub,
    importGitHubSkill,
  };
}
