import { setupPinia } from "@tracepilot/test-utils";
import type { Skill, SkillAsset, SkillImportResult, SkillSummary } from "@tracepilot/types";
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
  skillsListAssets: vi.fn(),
  skillsAddAsset: vi.fn(),
  skillsRemoveAsset: vi.fn(),
  skillsImportLocal: vi.fn(),
  skillsImportFile: vi.fn(),
  skillsImportGitHub: vi.fn(),
  skillsDiscoverRepos: vi.fn(),
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
  skillsListAssets: (...args: unknown[]) => hoistedMocks.skillsListAssets(...args),
  skillsAddAsset: (...args: unknown[]) => hoistedMocks.skillsAddAsset(...args),
  skillsRemoveAsset: (...args: unknown[]) => hoistedMocks.skillsRemoveAsset(...args),
  skillsImportLocal: (...args: unknown[]) => hoistedMocks.skillsImportLocal(...args),
  skillsImportFile: (...args: unknown[]) => hoistedMocks.skillsImportFile(...args),
  skillsImportGitHub: (...args: unknown[]) => hoistedMocks.skillsImportGitHub(...args),
  skillsDiscoverRepos: (...args: unknown[]) => hoistedMocks.skillsDiscoverRepos(...args),
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
  estimatedTokens: 500,
  hasAssets: true,
  assetCount: 2,
};

export const FIXTURE_SUMMARY_REPO: SkillSummary = {
  name: "test-gen",
  description: "Generates unit tests",
  scope: "repository",
  directory: "/home/user/repos/project/.copilot/skills/test-gen",
  enabled: false,
  estimatedTokens: 300,
  hasAssets: false,
  assetCount: 0,
};

export const FIXTURE_SUMMARY_DISABLED: SkillSummary = {
  name: "api-docs",
  description: "Generates API documentation",
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/api-docs",
  enabled: false,
  estimatedTokens: 200,
  hasAssets: false,
  assetCount: 0,
};

export const FIXTURE_SKILL: Skill = {
  scope: "global",
  directory: "/home/user/.config/github-copilot/skills/code-review",
  enabled: true,
  estimatedTokens: 500,
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
  });

  afterEach(async () => {
    await flushPromises();
  });
}
