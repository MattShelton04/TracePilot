import { setupPinia } from "@tracepilot/test-utils";
import type {
  Skill,
  SkillAsset,
  SkillImportResult,
  SkillSummary,
  SkillUsageStats,
} from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, vi } from "vitest";

export { createDeferred } from "@tracepilot/test-utils";

const hoistedMocks = vi.hoisted(() => ({
  skillsListAll: vi.fn(),
  skillsGetSkill: vi.fn(),
  skillsCreate: vi.fn(),
  skillsUpdate: vi.fn(),
  skillsUpdateRaw: vi.fn(),
  skillsDelete: vi.fn(),
  skillsRename: vi.fn(),
  skillsDuplicate: vi.fn(),
  skillsSetEnabled: vi.fn(),
  skillsListAssets: vi.fn(),
  skillsAddAsset: vi.fn(),
  skillsRemoveAsset: vi.fn(),
  skillsImportLocal: vi.fn(),
  skillsImportFile: vi.fn(),
  skillsImportGitHub: vi.fn(),
  skillsImportGitHubSkill: vi.fn(),
  skillsDiscoverRepos: vi.fn(),
  skillsUsageSummary: vi.fn(),
  logWarn: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", () => ({
  skillsListAll: (...args: unknown[]) => hoistedMocks.skillsListAll(...args),
  skillsGetSkill: (...args: unknown[]) => hoistedMocks.skillsGetSkill(...args),
  skillsCreate: (...args: unknown[]) => hoistedMocks.skillsCreate(...args),
  skillsUpdate: (...args: unknown[]) => hoistedMocks.skillsUpdate(...args),
  skillsUpdateRaw: (...args: unknown[]) => hoistedMocks.skillsUpdateRaw(...args),
  skillsDelete: (...args: unknown[]) => hoistedMocks.skillsDelete(...args),
  skillsRename: (...args: unknown[]) => hoistedMocks.skillsRename(...args),
  skillsDuplicate: (...args: unknown[]) => hoistedMocks.skillsDuplicate(...args),
  skillsSetEnabled: (...args: unknown[]) => hoistedMocks.skillsSetEnabled(...args),
  skillsListAssets: (...args: unknown[]) => hoistedMocks.skillsListAssets(...args),
  skillsAddAsset: (...args: unknown[]) => hoistedMocks.skillsAddAsset(...args),
  skillsRemoveAsset: (...args: unknown[]) => hoistedMocks.skillsRemoveAsset(...args),
  skillsImportLocal: (...args: unknown[]) => hoistedMocks.skillsImportLocal(...args),
  skillsImportFile: (...args: unknown[]) => hoistedMocks.skillsImportFile(...args),
  skillsImportGitHub: (...args: unknown[]) => hoistedMocks.skillsImportGitHub(...args),
  skillsImportGitHubSkill: (...args: unknown[]) => hoistedMocks.skillsImportGitHubSkill(...args),
  skillsDiscoverRepos: (...args: unknown[]) => hoistedMocks.skillsDiscoverRepos(...args),
  skillsUsageSummary: (...args: unknown[]) => hoistedMocks.skillsUsageSummary(...args),
}));

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => hoistedMocks.logWarn(...args),
}));

export const FIXTURE_SUMMARY: SkillSummary = {
  name: "code-review",
  description: "Reviews code changes for quality",
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/code-review",
  enabled: true,
  frontmatterTokens: 500,
  instructionTokens: 900,
  hasAssets: true,
  assetCount: 2,
  contentSha256: "sha-code-review",
};

export const FIXTURE_SUMMARY_REPO: SkillSummary = {
  name: "test-gen",
  description: "Generates unit tests",
  scope: "repository",
  directory: "/home/user/repos/project/.copilot/skills/test-gen",
  enabled: false,
  frontmatterTokens: 300,
  instructionTokens: 600,
  hasAssets: false,
  assetCount: 0,
  contentSha256: "sha-test-gen",
};

export const FIXTURE_SUMMARY_DISABLED: SkillSummary = {
  name: "api-docs",
  description: "Generates API documentation",
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/api-docs",
  enabled: false,
  frontmatterTokens: 200,
  instructionTokens: 400,
  hasAssets: false,
  assetCount: 0,
  contentSha256: "sha-api-docs",
};

export const FIXTURE_SUMMARY_BUILTIN: SkillSummary = {
  name: "customize-cloud-agent",
  description: "Customizes the Copilot cloud agent",
  scope: "builtin",
  directory: "/home/user/.copilot/pkg/linux-x64/1.0.75/builtin/customize-cloud-agent",
  enabled: true,
  frontmatterTokens: 400,
  instructionTokens: 800,
  hasAssets: false,
  assetCount: 0,
  contentSha256: "sha-customize-cloud-agent",
};

export const FIXTURE_SKILL: Skill = {
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/code-review",
  enabled: true,
  frontmatterTokens: 500,
  instructionTokens: 900,
  frontmatter: {
    name: "code-review",
    description: "Reviews code changes for quality",
  },
  body: "Review the code for quality issues.",
  rawContent:
    "---\nname: code-review\ndescription: Reviews code changes for quality\n---\nReview the code for quality issues.",
};

export const FIXTURE_ASSET: SkillAsset = {
  path: "/home/user/.config/github-copilot/skills/code-review/checklist.md",
  name: "checklist.md",
  sizeBytes: 1024,
  isDirectory: false,
};

export const FIXTURE_IMPORT_RESULT: SkillImportResult = {
  skillName: "imported-skill",
  destination: "/home/user/.config/github-copilot/skills/imported-skill",
  warnings: [],
  filesCopied: 3,
};

/** A usage row that resolves to `directory`, as the indexer reports one. */
export function usageStats(name: string, directory: string, uses: number): SkillUsageStats {
  return {
    name,
    normalizedName: name.toLowerCase(),
    description: null,
    uses,
    sessions: Math.min(uses, 3),
    repositories: 1,
    firstUsed: "2026-08-20T00:00:00Z",
    lastUsed: "2026-09-18T00:00:00Z",
    userInvoked: 0,
    agentInvoked: 0,
    unknownTrigger: uses,
    mainAgentUses: uses,
    subagentUses: 0,
    fallbackUses: 0,
    medianContentTokens: 1200,
    usesWithContent: uses,
    latestContentSha256: `sha-${name}`,
    contentVersions: 1,
    paths: [
      {
        path: `${directory}/SKILL.md`,
        directory: directory.replace(/\\/g, "/").toLowerCase(),
        uses,
      },
    ],
    topModels: [],
    topRepositories: [],
    dailyUses: [],
    pluginName: null,
    source: null,
  };
}

export const ALL_SUMMARIES: SkillSummary[] = [
  FIXTURE_SUMMARY,
  FIXTURE_SUMMARY_REPO,
  FIXTURE_SUMMARY_DISABLED,
];

function allMocks() {
  return Object.values(hoistedMocks);
}

export function setupSkillsStoreTest() {
  beforeEach(() => {
    setupPinia();
    for (const mock of allMocks()) mock.mockReset();
    hoistedMocks.skillsUsageSummary.mockResolvedValue({
      totalUses: 0,
      totalSessions: 0,
      unknownTriggerUses: 0,
      fallbackUses: 0,
      totalContentTokens: 0,
      usesWithContent: 0,
      skills: [],
    });
  });

  afterEach(async () => {
    await flushPromises();
  });
}
