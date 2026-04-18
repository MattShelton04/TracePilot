import type { GitHubSkillPreview, LocalSkillPreview } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import SkillImportWizard from "../../SkillImportWizard.vue";
import SkillImportStep1Local from "../SkillImportStep1Local.vue";
import SkillImportStep2GitHub from "../SkillImportStep2GitHub.vue";
import SkillImportStep3File from "../SkillImportStep3File.vue";
import {
  SkillImportWizardKey,
  type SkillImportWizardContext,
} from "@/composables/useSkillImportWizard";

// ── Mocks for shell-level (full-mount) tests ───────────────────────────
vi.mock("@/stores/skills", () => ({
  useSkillsStore: () => ({
    error: null,
    discoverLocal: vi.fn(async () => []),
    discoverGitHub: vi.fn(async () => []),
    importLocal: vi.fn(async () => null),
    importFile: vi.fn(async () => null),
    importGitHub: vi.fn(async () => null),
    importGitHubSkill: vi.fn(async () => null),
  }),
}));
vi.mock("@/stores/worktrees", () => ({
  useWorktreesStore: () => ({
    registeredRepos: [],
    loadRegisteredRepos: vi.fn(async () => {}),
  }),
}));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ recentRepoPaths: [] }),
}));
vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: vi.fn(async () => null),
  browseForFile: vi.fn(async () => null),
}));

// Load the feature CSS as a no-op — the test env does not parse the
// import for layout, but we stub it so the shell can mount.
vi.mock("@/styles/features/skill-import-wizard.css", () => ({}));

// ── Shared stub builder ────────────────────────────────────────────────
function makeWizardStub(overrides: Partial<SkillImportWizardContext> = {}): SkillImportWizardContext {
  const base = {
    worktreeStore: { registeredRepos: [] as Array<{ name: string; path: string }> },
    prefsStore: { recentRepoPaths: [] as string[] },
    activeTab: "local" as const,
    importing: false,
    importError: null as string | null,
    importResult: null,
    showResult: false,
    importStatusMessage: "",
    importCurrent: 0,
    importTotal: 0,
    localDir: "",
    localPreviews: [] as LocalSkillPreview[],
    localSelected: new Set<string>(),
    localScanning: false,
    filePath: "",
    ghRepoUrl: "",
    ghOwner: "",
    ghRepo: "",
    ghPath: "",
    ghRef: "",
    ghPreviews: [] as GitHubSkillPreview[],
    ghSelected: new Set<string>(),
    ghScanning: false,
    ghScanMessage: "",
    targetScope: "global" as const,
    canImport: false,
    scanLocal: vi.fn(),
    toggleLocalSkill: vi.fn(),
    toggleAllLocalSkills: vi.fn(),
    scanGitHub: vi.fn(),
    cancelScan: vi.fn(),
    toggleGhSkill: vi.fn(),
    toggleAllGhSkills: vi.fn(),
    doImport: vi.fn(),
    browseFile: vi.fn(),
    browseLocalDir: vi.fn(),
    onSelectRepo: vi.fn(),
    finish: vi.fn(),
    requestClose: vi.fn(),
    ...overrides,
  };
  return reactive(base) as unknown as SkillImportWizardContext;
}

function hostFor<C>(child: C, wizard: SkillImportWizardContext) {
  return defineComponent({
    setup() {
      provide(SkillImportWizardKey, wizard);
      return () => h(child as never);
    },
  });
}

describe("SkillImportStep1Local", () => {
  it("renders repository path input and triggers scanLocal", async () => {
    const wizard = makeWizardStub({ localDir: "/repo" });
    const wrapper = mount(hostFor(SkillImportStep1Local, wizard));
    expect(wrapper.find("input[type='text']").exists()).toBe(true);
    await wrapper.find(".btn-scan").trigger("click");
    expect(wizard.scanLocal).toHaveBeenCalled();
  });

  it("lists previews and toggles selection when row is clicked", async () => {
    const previews = [
      { path: "/a", name: "A", description: "", fileCount: 1 } as LocalSkillPreview,
      { path: "/b", name: "B", description: "desc", fileCount: 2 } as LocalSkillPreview,
    ];
    const wizard = makeWizardStub({
      localDir: "/x",
      localPreviews: previews,
      localSelected: new Set(["/a", "/b"]),
    });
    const wrapper = mount(hostFor(SkillImportStep1Local, wizard));
    const items = wrapper.findAll(".gh-preview__item");
    expect(items).toHaveLength(2);
    await items[0]!.trigger("click");
    expect(wizard.toggleLocalSkill).toHaveBeenCalledWith("/a");
  });
});

describe("SkillImportStep2GitHub", () => {
  it("triggers scanGitHub on the Scan button", async () => {
    const wizard = makeWizardStub({ activeTab: "github", ghRepoUrl: "acme/tools" });
    const wrapper = mount(hostFor(SkillImportStep2GitHub, wizard));
    await wrapper.find(".btn-scan").trigger("click");
    expect(wizard.scanGitHub).toHaveBeenCalled();
  });

  it("scans when Enter is pressed in the URL input (keyboard-nav)", async () => {
    const wizard = makeWizardStub({ activeTab: "github", ghRepoUrl: "acme/tools" });
    const wrapper = mount(hostFor(SkillImportStep2GitHub, wizard));
    const input = wrapper.find("input[type='text']");
    await input.trigger("keyup.enter");
    expect(wizard.scanGitHub).toHaveBeenCalled();
  });

  it("shows Cancel button while scanning and invokes cancelScan", async () => {
    const wizard = makeWizardStub({
      activeTab: "github",
      ghScanning: true,
      ghScanMessage: "Connecting…",
    });
    const wrapper = mount(hostFor(SkillImportStep2GitHub, wizard));
    const cancel = wrapper.find(".btn-cancel");
    expect(cancel.exists()).toBe(true);
    await cancel.trigger("click");
    expect(wizard.cancelScan).toHaveBeenCalled();
  });
});

describe("SkillImportStep3File", () => {
  it("browses for a file on drop-zone click", async () => {
    const wizard = makeWizardStub({ activeTab: "file" });
    const wrapper = mount(hostFor(SkillImportStep3File, wizard));
    await wrapper.find(".drop-zone").trigger("click");
    expect(wizard.browseFile).toHaveBeenCalled();
  });

  it("binds the manual file-path input to wizard.filePath", async () => {
    const wizard = makeWizardStub({ activeTab: "file" });
    const wrapper = mount(hostFor(SkillImportStep3File, wizard));
    const input = wrapper.find("input[type='text']");
    await input.setValue("/path/SKILL.md");
    expect(wizard.filePath).toBe("/path/SKILL.md");
  });
});

describe("SkillImportWizard shell", () => {
  it("emits close when Escape key is pressed (keyboard-nav)", async () => {
    const wrapper = mount(SkillImportWizard, { attachTo: document.body });
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("emits close when cancel button is clicked", async () => {
    const wrapper = mount(SkillImportWizard);
    await wrapper.find(".wizard__btn--secondary").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
