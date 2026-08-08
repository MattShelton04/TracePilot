import {
  skillsImportFile,
  skillsImportGitHub,
  skillsImportGitHubSkill,
  skillsImportLocal,
} from "@tracepilot/client";
import type { SkillBatchImportResult, SkillImportResult } from "@tracepilot/types";
import { runMutation, toErrorMessage } from "@tracepilot/ui";
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
      await loadSkills(repoRoot);
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
      await loadSkills(repoRoot);
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
      await loadSkills(repoRoot);
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
      await loadSkills(repoRoot);
      return result;
    });
  }

  async function runBatch(
    sources: string[],
    worker: (source: string) => Promise<SkillImportResult>,
    repoRoot?: string,
  ): Promise<SkillBatchImportResult> {
    error.value = null;
    const items: SkillBatchImportResult["items"] = new Array(sources.length);
    let cursor = 0;
    async function consume() {
      while (cursor < sources.length) {
        const index = cursor++;
        const source = sources[index];
        try {
          items[index] = { source, result: await worker(source) };
        } catch (errorValue) {
          items[index] = { source, error: toErrorMessage(errorValue) };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, sources.length) }, consume));
    const succeeded = items.filter((item) => item.result).length;
    if (succeeded > 0) await loadSkills(repoRoot);
    return {
      items,
      succeeded,
      failed: items.length - succeeded,
      filesCopied: items.reduce((sum, item) => sum + (item.result?.filesCopied ?? 0), 0),
      warnings: items.flatMap((item) => item.result?.warnings ?? []),
    };
  }

  function importLocalBatch(
    sourceDirs: string[],
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillBatchImportResult> {
    return runBatch(sourceDirs, (source) => skillsImportLocal(source, scope, repoRoot), repoRoot);
  }

  function importGitHubBatch(
    owner: string,
    repo: string,
    skillPaths: string[],
    gitRef?: string,
    scope?: string,
    repoRoot?: string,
  ): Promise<SkillBatchImportResult> {
    return runBatch(
      skillPaths,
      (path) => skillsImportGitHubSkill(owner, repo, path, gitRef, scope, repoRoot),
      repoRoot,
    );
  }

  return {
    importLocal,
    importFile,
    importGitHub,
    importGitHubSkill,
    importLocalBatch,
    importGitHubBatch,
  };
}
