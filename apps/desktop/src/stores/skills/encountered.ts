import { skillsEncounteredProject } from "@tracepilot/client";
import type {
  EncounteredSkillSummary as BackendEncounteredSkillSummary,
  SkillSummary,
} from "@tracepilot/types";

const RECENT_SESSION_LIMIT = 100;

export interface EncounteredSkillSummary extends SkillSummary {
  source: "session";
  invocationCount: number;
  sourcePath: string;
}

export type DisplaySkillSummary = SkillSummary | EncounteredSkillSummary;

export function isEncounteredSkill(skill: DisplaySkillSummary): skill is EncounteredSkillSummary {
  return "source" in skill && skill.source === "session";
}

export async function discoverEncounteredProjectSkills(
  installedSkills: readonly SkillSummary[],
): Promise<EncounteredSkillSummary[]> {
  const installedNames = installedSkills.map((skill) => skill.name);
  const encountered = await skillsEncounteredProject(installedNames, RECENT_SESSION_LIMIT);
  return encountered.map(toDisplaySummary);
}

function toDisplaySummary(skill: BackendEncounteredSkillSummary): EncounteredSkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    scope: "repository",
    directory: skill.directory,
    estimatedTokens: skill.estimatedTokens,
    enabled: true,
    hasAssets: false,
    assetCount: 0,
    source: "session",
    invocationCount: skill.invocationCount,
    sourcePath: skill.sourcePath,
  };
}
