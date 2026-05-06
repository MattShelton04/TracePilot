import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import { type SkillEditorContext, SkillEditorKey } from "@/composables/useSkillEditor";
import SkillAssetPreviewModal from "../SkillAssetPreviewModal.vue";
import SkillEditorMarkdownEditor from "../SkillEditorMarkdownEditor.vue";
import SkillEditorMetadataForm from "../SkillEditorMetadataForm.vue";
import SkillEditorPreviewPane from "../SkillEditorPreviewPane.vue";
import SkillEditorStatusBar from "../SkillEditorStatusBar.vue";
import SkillEditorTopBar from "../SkillEditorTopBar.vue";

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    MarkdownContent: {
      name: "MarkdownContent",
      props: ["content"],
      template: '<div class="md-stub">{{ content }}</div>',
    },
  };
});

vi.mock("@/utils/openExternal", () => ({
  openExternal: vi.fn(),
}));

function makeCtx(overrides: Partial<SkillEditorContext> = {}): SkillEditorContext {
  const base = {
    store: {
      selectedSkill: {
        directory: "my-skill",
        frontmatter: { name: "My Skill", description: "desc" },
        scope: "project" as const,
        estimatedTokens: 1234,
      },
      error: null as string | null,
    },
    saving: false,
    deleting: false,
    rawContent: "raw",
    assets: [],
    assetsLoading: false,
    editorDirty: false,
    lastSaved: null,
    editorRef: null,
    lineNumbersRef: null,
    viewingAsset: null,
    viewingContent: null,
    previewFrontmatter: { name: "My Skill", description: "desc" },
    previewBody: "# Body",
    leftWidth: 50,
    dragging: false,
    containerRef: null,
    onMouseDown: vi.fn(),
    skillDir: "my-skill",
    editorLineNumbers: [1],
    totalLineCount: 1,
    byteCount: 10,
    descCharCount: 4,
    descCharClass: "",
    lastSavedDisplay: "Not saved yet",
    backLabel: "Back to Skills",
    loadSkill: vi.fn(),
    handleSave: vi.fn(),
    handleDelete: vi.fn(),
    handleDiscard: vi.fn(),
    handleAddAsset: vi.fn(),
    handleNewFile: vi.fn(),
    handleRemoveAsset: vi.fn(),
    handleViewAsset: vi.fn(),
    handlePreviewClick: vi.fn(),
    goBack: vi.fn(),
    onBodyInput: vi.fn(),
    onNameInput: vi.fn(),
    onDescInput: vi.fn(),
    insertBold: vi.fn(),
    insertItalic: vi.fn(),
    insertH1: vi.fn(),
    insertH2: vi.fn(),
    insertBulletList: vi.fn(),
    insertCode: vi.fn(),
    insertLink: vi.fn(),
    formatSize: (n: number) => `${n} B`,
    syncScroll: vi.fn(),
    closeAssetPreview: vi.fn(),
  };
  return reactive({ ...base, ...overrides }) as unknown as SkillEditorContext;
}

function mountWithCtx<T>(component: T, ctx: SkillEditorContext) {
  const Harness = defineComponent({
    components: { Child: component as never },
    setup() {
      provide(SkillEditorKey, ctx);
      return () => h("div", [h(component as never)]);
    },
  });
  return mount(Harness);
}

describe("SkillEditorTopBar", () => {
  it("renders skill name + calls goBack on back click", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorTopBar, ctx);
    expect(wrapper.text()).toContain("My Skill");
    await wrapper.find(".topbar-back").trigger("click");
    expect(ctx.goBack).toHaveBeenCalled();
  });

  it("disables save button when not dirty, enables when dirty", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorTopBar, ctx);
    const saveBtn = wrapper.find(".btn-primary");
    expect(saveBtn.attributes("disabled")).toBeDefined();
    ctx.editorDirty = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".btn-primary").attributes("disabled")).toBeUndefined();
    await wrapper.find(".btn-primary").trigger("click");
    expect(ctx.handleSave).toHaveBeenCalled();
  });
});

describe("SkillEditorMetadataForm", () => {
  it("binds frontmatter name/description and fires input handlers", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorMetadataForm, ctx);
    const input = wrapper.find(".field-input");
    expect((input.element as HTMLInputElement).value).toBe("My Skill");
    await input.trigger("input");
    expect(ctx.onNameInput).toHaveBeenCalled();

    const textarea = wrapper.find(".field-textarea");
    await textarea.trigger("input");
    expect(ctx.onDescInput).toHaveBeenCalled();
  });

  it("renders char-count with class", () => {
    const ctx = makeCtx({ descCharCount: 950, descCharClass: "near-limit" } as never);
    const wrapper = mountWithCtx(SkillEditorMetadataForm, ctx);
    expect(wrapper.find(".char-count").classes()).toContain("near-limit");
    expect(wrapper.find(".char-count").text()).toContain("950");
  });
});

describe("SkillEditorMarkdownEditor", () => {
  it("toolbar buttons call insertX handlers", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorMarkdownEditor, ctx);
    await wrapper.find('button[title="Bold"]').trigger("click");
    expect(ctx.insertBold).toHaveBeenCalled();
    await wrapper.find('button[title="Italic"]').trigger("click");
    expect(ctx.insertItalic).toHaveBeenCalled();
    await wrapper.find('button[title="Link"]').trigger("click");
    expect(ctx.insertLink).toHaveBeenCalled();
  });

  it("textarea bound to previewBody and fires onBodyInput", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorMarkdownEditor, ctx);
    const ta = wrapper.find("textarea.md-textarea");
    expect((ta.element as HTMLTextAreaElement).value).toBe("# Body");
    await ta.trigger("input");
    expect(ctx.onBodyInput).toHaveBeenCalled();
  });
});

describe("SkillEditorPreviewPane", () => {
  it("renders previewFrontmatter name + body + assets tree", () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorPreviewPane, ctx);
    expect(wrapper.text()).toContain("My Skill");
    expect(wrapper.find(".md-stub").exists()).toBe(true);
    expect(wrapper.find(".assets-section").exists()).toBe(true);
  });

  it("preview click delegates to handlePreviewClick", async () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillEditorPreviewPane, ctx);
    await wrapper.find(".preview-markdown").trigger("click");
    expect(ctx.handlePreviewClick).toHaveBeenCalled();
  });
});

describe("SkillEditorStatusBar", () => {
  it("shows directory and last-saved display", () => {
    const ctx = makeCtx({
      lastSavedDisplay: "Just saved",
      totalLineCount: 42,
      byteCount: 999,
    } as never);
    const wrapper = mountWithCtx(SkillEditorStatusBar, ctx);
    expect(wrapper.text()).toContain("my-skill/SKILL.md");
    expect(wrapper.text()).toContain("Just saved");
    expect(wrapper.text()).toContain("42 lines");
  });
});

describe("SkillAssetPreviewModal", () => {
  it("hidden when no viewingAsset", () => {
    const ctx = makeCtx();
    const wrapper = mountWithCtx(SkillAssetPreviewModal, ctx);
    expect(wrapper.find(".asset-preview-overlay").exists()).toBe(false);
  });

  it("renders asset name + content, closes on ✕ click", async () => {
    const ctx = makeCtx({
      viewingAsset: { name: "a.md", path: "a.md", isDirectory: false, sizeBytes: 10 },
      viewingContent: "hello",
    } as never);
    const wrapper = mountWithCtx(SkillAssetPreviewModal, ctx);
    expect(wrapper.find(".asset-preview-overlay").exists()).toBe(true);
    expect(wrapper.text()).toContain("a.md");
    expect(wrapper.text()).toContain("hello");
    await wrapper.find(".asset-preview-close").trigger("click");
    expect(ctx.closeAssetPreview).toHaveBeenCalled();
  });

  it("shows fallback when viewingContent is null for non-directory", () => {
    const ctx = makeCtx({
      viewingAsset: { name: "x.bin", path: "x.bin", isDirectory: false, sizeBytes: 5 },
      viewingContent: null,
    } as never);
    const wrapper = mountWithCtx(SkillAssetPreviewModal, ctx);
    expect(wrapper.text()).toContain("Unable to read file content");
  });
});
