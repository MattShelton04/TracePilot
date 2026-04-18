import type { LocalSkillPreview, SkillImportResult } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

// ── Mocks ──────────────────────────────────────────────────────────────
const skillsStoreMock = {
  error: null as string | null,
  discoverLocal: vi.fn<(dir: string) => Promise<LocalSkillPreview[]>>(async () => []),
  discoverGitHub: vi.fn(async () => [] as LocalSkillPreview[]),
  importLocal: vi.fn<
    (dir: string, scope?: string) => Promise<SkillImportResult | null>
  >(async () => null),
  importFile: vi.fn<
    (path: string, scope?: string) => Promise<SkillImportResult | null>
  >(async () => null),
  importGitHub: vi.fn(async () => null as SkillImportResult | null),
  importGitHubSkill: vi.fn(async () => null as SkillImportResult | null),
};
vi.mock("@/stores/skills", () => ({
  useSkillsStore: () => skillsStoreMock,
}));

const worktreesStoreMock = {
  registeredRepos: [] as Array<{ name: string; path: string }>,
  loadRegisteredRepos: vi.fn(async () => {}),
};
vi.mock("@/stores/worktrees", () => ({
  useWorktreesStore: () => worktreesStoreMock,
}));

const prefsStoreMock = {
  recentRepoPaths: [] as string[],
};
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => prefsStoreMock,
}));

const browseForDirectoryMock = vi.fn<() => Promise<string | null>>(async () => null);
const browseForFileMock = vi.fn<() => Promise<string | null>>(async () => null);
vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: (...args: unknown[]) => browseForDirectoryMock(...(args as [])),
  browseForFile: (...args: unknown[]) => browseForFileMock(...(args as [])),
}));

// Import under test AFTER mocks
import { useSkillImportWizard } from "../useSkillImportWizard";

interface WizardHandlers {
  onImported: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function mountWizard(handlers?: Partial<WizardHandlers>) {
  const onImported = handlers?.onImported ?? vi.fn();
  const onClose = handlers?.onClose ?? vi.fn();
  const TestHost = defineComponent({
    setup() {
      const wizard = useSkillImportWizard({ onImported, onClose });
      return { wizard };
    },
    template: "<div />",
  });
  const wrapper = mount(TestHost);
  return { wrapper, wizard: wrapper.vm.wizard, onImported, onClose };
}

function makeLocalPreview(overrides: Partial<LocalSkillPreview> = {}): LocalSkillPreview {
  return {
    path: "/repo/skills/demo",
    name: "demo",
    description: "demo skill",
    fileCount: 3,
    ...overrides,
  } as LocalSkillPreview;
}

describe("useSkillImportWizard", () => {
  beforeEach(() => {
    setupPinia();
    skillsStoreMock.error = null;
    skillsStoreMock.discoverLocal = vi.fn(async () => []);
    skillsStoreMock.discoverGitHub = vi.fn(async () => []);
    skillsStoreMock.importLocal = vi.fn(async () => null);
    skillsStoreMock.importFile = vi.fn(async () => null);
    skillsStoreMock.importGitHub = vi.fn(async () => null);
    skillsStoreMock.importGitHubSkill = vi.fn(async () => null);
    worktreesStoreMock.registeredRepos = [];
    worktreesStoreMock.loadRegisteredRepos = vi.fn(async () => {});
    prefsStoreMock.recentRepoPaths = [];
    browseForDirectoryMock.mockReset();
    browseForFileMock.mockReset();
  });

  it("initializes with default wizard state", () => {
    const { wizard } = mountWizard();
    expect(wizard.activeTab).toBe("local");
    expect(wizard.targetScope).toBe("global");
    expect(wizard.importing).toBe(false);
    expect(wizard.showResult).toBe(false);
    expect(wizard.canImport).toBe(false);
  });

  it("canImport reflects active tab and inputs", () => {
    const { wizard } = mountWizard();
    wizard.localDir = "/path";
    expect(wizard.canImport).toBe(true);
    wizard.activeTab = "file";
    expect(wizard.canImport).toBe(false);
    wizard.filePath = "/path/SKILL.md";
    expect(wizard.canImport).toBe(true);
    wizard.activeTab = "github";
    wizard.ghRepoUrl = "https://github.com/foo/bar";
    expect(wizard.canImport).toBe(true);
  });

  it("scanLocal populates previews and auto-selects all", async () => {
    const previews = [
      makeLocalPreview({ path: "/a", name: "a" }),
      makeLocalPreview({ path: "/b", name: "b" }),
    ];
    skillsStoreMock.discoverLocal = vi.fn(async () => previews);
    const { wizard } = mountWizard();
    wizard.localDir = "/repo";
    await wizard.scanLocal();
    expect(wizard.localPreviews).toHaveLength(2);
    expect(wizard.localSelected.size).toBe(2);
    expect(wizard.localScanning).toBe(false);
    expect(wizard.importError).toBeNull();
  });

  it("scanLocal surfaces an error when no skills found", async () => {
    skillsStoreMock.discoverLocal = vi.fn(async () => []);
    const { wizard } = mountWizard();
    wizard.localDir = "/empty";
    await wizard.scanLocal();
    expect(wizard.localPreviews).toHaveLength(0);
    expect(wizard.importError).toContain("No skills found");
  });

  it("toggleLocalSkill and toggleAllLocalSkills manage selection", async () => {
    const previews = [
      makeLocalPreview({ path: "/a" }),
      makeLocalPreview({ path: "/b" }),
    ];
    skillsStoreMock.discoverLocal = vi.fn(async () => previews);
    const { wizard } = mountWizard();
    wizard.localDir = "/repo";
    await wizard.scanLocal();
    expect(wizard.localSelected.size).toBe(2);
    wizard.toggleAllLocalSkills();
    expect(wizard.localSelected.size).toBe(0);
    wizard.toggleLocalSkill("/a");
    expect(wizard.localSelected.has("/a")).toBe(true);
    wizard.toggleLocalSkill("/a");
    expect(wizard.localSelected.has("/a")).toBe(false);
  });

  it("parses full github URLs via scanGitHub", async () => {
    skillsStoreMock.discoverGitHub = vi.fn(async () => []);
    const { wizard } = mountWizard();
    wizard.ghRepoUrl = "https://github.com/acme/tools/tree/main/skills";
    await wizard.scanGitHub();
    expect(wizard.ghOwner).toBe("acme");
    expect(wizard.ghRepo).toBe("tools");
    expect(wizard.ghRef).toBe("main");
    expect(wizard.ghPath).toBe("skills");
    expect(skillsStoreMock.discoverGitHub).toHaveBeenCalledWith(
      "acme",
      "tools",
      "skills",
      "main",
    );
  });

  it("scanGitHub reports a parse error on unparseable input", async () => {
    const { wizard } = mountWizard();
    wizard.ghRepoUrl = "!!!";
    await wizard.scanGitHub();
    expect(wizard.importError).toContain("Could not parse");
    expect(wizard.ghScanning).toBe(false);
  });

  it("doImport for file invokes store.importFile and records result", async () => {
    const result: SkillImportResult = {
      skillName: "demo",
      destination: "/out",
      warnings: [],
      filesCopied: 1,
    };
    skillsStoreMock.importFile = vi.fn(async () => result);
    const { wizard } = mountWizard();
    wizard.activeTab = "file";
    wizard.filePath = "/path/SKILL.md";
    await wizard.doImport();
    expect(skillsStoreMock.importFile).toHaveBeenCalledWith("/path/SKILL.md", "global");
    expect(wizard.showResult).toBe(true);
    expect(wizard.importResult).toEqual(result);
    expect(wizard.importing).toBe(false);
  });

  it("finish emits onImported and onClose", () => {
    const { wizard, onImported, onClose } = mountWizard();
    const result: SkillImportResult = {
      skillName: "demo",
      destination: "",
      warnings: [],
      filesCopied: 1,
    };
    wizard.importResult = result;
    wizard.finish();
    expect(onImported).toHaveBeenCalledWith(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("browseFile stores the selected path", async () => {
    browseForFileMock.mockResolvedValueOnce("/chosen/SKILL.md");
    const { wizard } = mountWizard();
    await wizard.browseFile();
    expect(wizard.filePath).toBe("/chosen/SKILL.md");
  });

  it("onSelectRepo writes to localDir", () => {
    const { wizard } = mountWizard();
    const event = { target: { value: "/picked" } } as unknown as Event;
    wizard.onSelectRepo(event);
    expect(wizard.localDir).toBe("/picked");
  });
});
