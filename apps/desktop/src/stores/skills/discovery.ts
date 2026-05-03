import { skillsDiscoverGitHub, skillsDiscoverLocal, skillsDiscoverRepos } from "@tracepilot/client";
import type { GitHubSkillPreview, LocalSkillPreview, RepoSkillsResult } from "@tracepilot/types";
import { runMutation } from "@tracepilot/ui";
import type { SkillsContext } from "./context";

export function createSkillsDiscoveryActions(context: SkillsContext) {
  const { error } = context;

  async function discoverGitHub(
    owner: string,
    repo: string,
    path?: string,
    gitRef?: string,
  ): Promise<GitHubSkillPreview[]> {
    return (await runMutation(error, () => skillsDiscoverGitHub(owner, repo, path, gitRef))) ?? [];
  }

  async function discoverLocal(dir: string): Promise<LocalSkillPreview[]> {
    return (await runMutation(error, () => skillsDiscoverLocal(dir))) ?? [];
  }

  async function discoverRepos(repos: [string, string][]): Promise<RepoSkillsResult[]> {
    return (await runMutation(error, () => skillsDiscoverRepos(repos))) ?? [];
  }

  return {
    discoverGitHub,
    discoverLocal,
    discoverRepos,
  };
}
