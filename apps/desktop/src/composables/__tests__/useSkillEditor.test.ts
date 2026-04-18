import type { SkillAsset, SkillFrontmatter } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide } from "vue";

// ─── Mocks ──────────────────────────────────────────────────────────────

const routeMock = { params: { name: "my-skill" } };
const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("vue-router", () => ({
  useRoute: () => routeMock,
  useRouter: () => routerMock,
}));

const confirmMock = vi.fn<(opts?: unknown) => Promise<{ confirmed: boolean }>>(async () => ({ confirmed: true }));
vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    useConfirmDialog: () => ({ confirm: (opts: unknown) => confirmMock(opts) }),
    useResizeHandle: () => ({
      leftWidth: { value: 50 },
      dragging: { value: false },
      containerRef: { value: null },
      onMouseDown: vi.fn(),
    }),
  };
});

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForFile: vi.fn(async () => "/path/to/file.txt"),
  browseForDirectory: vi.fn(async () => null),
}));

vi.mock("@/utils/logger", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const storeMock = {
  selectedSkill: null as null | {
    directory: string;
    rawContent: string;
    frontmatter: SkillFrontmatter;
    scope: "global" | "project";
    estimatedTokens: number;
  },
  error: null as string | null,
  getSkill: vi.fn(async (_dir: string) => storeMock.selectedSkill),
  updateSkillRaw: vi.fn(async () => true),
  deleteSkill: vi.fn(async () => true),
  listAssets: vi.fn(async () => [] as SkillAsset[]),
  addAsset: vi.fn(async () => true),
  removeAsset: vi.fn(async () => true),
  copyAssetFrom: vi.fn(async () => true),
  readAsset: vi.fn(async (_dir: string, _path: string) => "asset contents"),
};
vi.mock("@/stores/skills", () => ({
  useSkillsStore: () => storeMock,
}));

// Import after mocks
import { SkillEditorKey, useSkillEditor, useSkillEditorContext } from "../useSkillEditor";

function mountHarness() {
  const ctxHolder: { ctx: ReturnType<typeof useSkillEditor> | null } = { ctx: null };
  const Harness = defineComponent({
    setup() {
      const ctx = useSkillEditor();
      provide(SkillEditorKey, ctx);
      ctxHolder.ctx = ctx;
      return () => h("div");
    },
  });
  const wrapper = mount(Harness);
  return { wrapper, get ctx() { return ctxHolder.ctx!; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue({ confirmed: true });
  storeMock.selectedSkill = {
    directory: "my-skill",
    rawContent: "---\nname: my-skill\ndescription: hello\n---\n\n# Body",
    frontmatter: { name: "my-skill", description: "hello" } as SkillFrontmatter,
    scope: "project",
    estimatedTokens: 100,
  };
  storeMock.error = null;
  storeMock.listAssets.mockResolvedValue([]);
  storeMock.getSkill.mockImplementation(async () => storeMock.selectedSkill);
});

describe("useSkillEditor", () => {
  it("derives skillDir from the route param (url-decoded)", () => {
    routeMock.params.name = encodeURIComponent("project/my-skill");
    const { ctx, wrapper } = mountHarness();
    expect(ctx.skillDir).toBe("project/my-skill");
    wrapper.unmount();
    routeMock.params.name = "my-skill";
  });

  it("loadSkill fetches skill + parses frontmatter + lists assets", async () => {
    storeMock.listAssets.mockResolvedValue([
      { name: "a.md", path: "a.md", isDirectory: false, sizeBytes: 10 },
    ]);
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(storeMock.getSkill).toHaveBeenCalledWith("my-skill");
    expect(ctx.previewBody.trim()).toBe("# Body");
    expect(ctx.previewFrontmatter?.name).toBe("my-skill");
    expect(ctx.assets).toHaveLength(1);
    expect(ctx.editorDirty).toBe(false);
    wrapper.unmount();
  });

  it("handleSave calls the store, clears dirty + reloads, and stamps lastSaved", async () => {
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));
    ctx.rawContent = "modified";
    ctx.editorDirty = true;

    await ctx.handleSave();

    expect(storeMock.updateSkillRaw).toHaveBeenCalledWith("my-skill", "modified");
    expect(ctx.editorDirty).toBe(false);
    expect(ctx.saving).toBe(false);
    expect(ctx.lastSaved).not.toBeNull();
    wrapper.unmount();
  });

  it("onNameInput rebuilds raw content and marks dirty", async () => {
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));

    ctx.onNameInput({ target: { value: "renamed" } } as unknown as Event);
    expect(ctx.previewFrontmatter?.name).toBe("renamed");
    expect(ctx.editorDirty).toBe(true);
    expect(ctx.rawContent).toContain("name: renamed");
    wrapper.unmount();
  });

  it("Ctrl+S keydown triggers handleSave when dirty, no-op otherwise", async () => {
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));

    // Not dirty: should not call updateSkillRaw
    const e1 = new KeyboardEvent("keydown", { key: "s", ctrlKey: true });
    document.dispatchEvent(e1);
    await new Promise((r) => setTimeout(r, 0));
    expect(storeMock.updateSkillRaw).not.toHaveBeenCalled();

    // Dirty → should save
    ctx.editorDirty = true;
    ctx.rawContent = "x";
    const e2 = new KeyboardEvent("keydown", { key: "s", ctrlKey: true });
    document.dispatchEvent(e2);
    await new Promise((r) => setTimeout(r, 0));
    expect(storeMock.updateSkillRaw).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("handleDiscard reloads when confirmed, no-op when not dirty", async () => {
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));
    storeMock.getSkill.mockClear();

    await ctx.handleDiscard();
    expect(storeMock.getSkill).not.toHaveBeenCalled();

    ctx.editorDirty = true;
    await ctx.handleDiscard();
    expect(storeMock.getSkill).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("handleDelete navigates to skills manager on success", async () => {
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));

    await ctx.handleDelete();
    expect(storeMock.deleteSkill).toHaveBeenCalledWith("my-skill");
    expect(routerMock.push).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("descCharClass thresholds", async () => {
    const { ctx, wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));
    ctx.previewFrontmatter = { name: "x", description: "a".repeat(500) } as SkillFrontmatter;
    expect(ctx.descCharClass).toBe("");
    ctx.previewFrontmatter = { name: "x", description: "a".repeat(950) } as SkillFrontmatter;
    expect(ctx.descCharClass).toBe("near-limit");
    ctx.previewFrontmatter = { name: "x", description: "a".repeat(1100) } as SkillFrontmatter;
    expect(ctx.descCharClass).toBe("at-limit");
    wrapper.unmount();
  });

  it("formatSize handles all three ranges", async () => {
    const { ctx, wrapper } = mountHarness();
    expect(ctx.formatSize(512)).toBe("512 B");
    expect(ctx.formatSize(2048)).toBe("2.0 KB");
    expect(ctx.formatSize(2 * 1024 * 1024)).toBe("2.0 MB");
    wrapper.unmount();
  });

  it("useSkillEditorContext throws when not provided", () => {
    const Bad = defineComponent({
      setup() {
        useSkillEditorContext();
        return () => h("div");
      },
    });
    expect(() => mount(Bad)).toThrow();
  });
});
